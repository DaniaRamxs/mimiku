'use strict';

/**
 * vtsClient.js
 *
 * Cliente WebSocket para la API pública de VTube Studio, con dos "ruletas":
 *
 *  - spinItemRoulette()   -> mismo modelo, cambia un ítem/accesorio, se revierte solo
 *  - spinAvatarRoulette() -> cambia el modelo completo, se queda fijo hasta el próximo giro
 *
 * Requiere: npm install ws
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const PLUGIN_API_NAME = 'VTubeStudioPublicAPI';
const PLUGIN_API_VERSION = '1.0';
const REQUEST_TIMEOUT_MS = 8000;

class VTSClient extends EventEmitter {
  constructor(configPath) {
    super();
    this.configPath = configPath || path.join(__dirname, 'vts-roulette-config.json');
    this.config = this._loadConfig();

    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.authToken = null;

    this._pending = new Map();
    this._reqCounter = 0;

    this.activeItemInstanceId = null;
    this.activeItemTimer = null;
  }

  // ---------------------------------------------------------------------
  // Config / token persistence
  // ---------------------------------------------------------------------

  _loadConfig() {
    const raw = fs.readFileSync(this.configPath, 'utf-8');
    return JSON.parse(raw);
  }

  reloadConfig() {
    this.config = this._loadConfig();
    return this.config;
  }

  _resolveTokenPath() {
    const tokenPath = this.config.connection.tokenPath || './vts-token.json';
    return path.isAbsolute(tokenPath)
      ? tokenPath
      : path.join(path.dirname(this.configPath), tokenPath);
  }

  _loadToken() {
    try {
      const raw = fs.readFileSync(this._resolveTokenPath(), 'utf-8');
      return JSON.parse(raw).authenticationToken || null;
    } catch (e) {
      return null;
    }
  }

  _saveToken(token) {
    fs.writeFileSync(
      this._resolveTokenPath(),
      JSON.stringify({ authenticationToken: token }, null, 2),
      'utf-8'
    );
  }

  // ---------------------------------------------------------------------
  // Connection / auth
  // ---------------------------------------------------------------------

  connect() {
    return new Promise((resolve, reject) => {
      const url = this.config.connection.url || 'ws://localhost:8001';
      this.ws = new WebSocket(url);

      this.ws.on('open', async () => {
        this.connected = true;
        this.emit('connected');
        try {
          await this._authenticate();
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on('message', (data) => this._handleMessage(data));

      this.ws.on('close', () => {
        this.connected = false;
        this.authenticated = false;
        this.emit('disconnected');
      });

      this.ws.on('error', (err) => {
        this.emit('error', err);
        if (!this.connected) reject(err);
      });
    });
  }

  disconnect() {
    if (this.activeItemTimer) clearTimeout(this.activeItemTimer);
    if (this.ws) this.ws.close();
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    const requestID = msg.requestID;
    if (requestID && this._pending.has(requestID)) {
      const { resolve, reject } = this._pending.get(requestID);
      this._pending.delete(requestID);
      if (msg.messageType === 'APIError') {
        reject(new Error(`VTS API error ${msg.data.errorID}: ${msg.data.message}`));
      } else {
        resolve(msg.data);
      }
      return;
    }

    if (msg.messageType && msg.messageType.endsWith('Event')) {
      this.emit('vtsEvent', msg);
    }
  }

  _send(messageType, data = {}) {
    const requestID = `req_${++this._reqCounter}_${Date.now()}`;
    const envelope = {
      apiName: PLUGIN_API_NAME,
      apiVersion: PLUGIN_API_VERSION,
      requestID,
      messageType,
      data
    };

    return new Promise((resolve, reject) => {
      this._pending.set(requestID, { resolve, reject });
      this.ws.send(JSON.stringify(envelope));
      setTimeout(() => {
        if (this._pending.has(requestID)) {
          this._pending.delete(requestID);
          reject(new Error(`Timeout esperando respuesta a ${messageType}`));
        }
      }, REQUEST_TIMEOUT_MS);
    });
  }

  async _authenticate() {
    const { pluginName, pluginDeveloper } = this.config.connection;
    this.authToken = this._loadToken();

    if (!this.authToken) {
      const tokenResp = await this._send('AuthenticationTokenRequest', {
        pluginName,
        pluginDeveloper
      });
      this.authToken = tokenResp.authenticationToken;
      this._saveToken(this.authToken);
    }

    const authResp = await this._send('AuthenticationRequest', {
      pluginName,
      pluginDeveloper,
      authenticationToken: this.authToken
    });

    if (!authResp.authenticated) {
      throw new Error('Autenticación con VTS falló. Revisá el popup en VTube Studio.');
    }

    this.authenticated = true;
    this.emit('authenticated');
  }

  // ---------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------

  async getAvailableModels() {
    const resp = await this._send('AvailableModelsRequest');
    return resp.availableModels;
  }

  async getAvailableItemFiles() {
    const resp = await this._send('ItemListRequest', {
      includeAvailableItemFiles: true,
      onlyItemsWithFileNameField: [],
      onlyItemsWithInstanceID: []
    });
    return resp.availableItemFiles;
  }

  async refreshModelsFromVTS() {
    const models = await this.getAvailableModels();
    const cachePath = path.join(path.dirname(this.configPath), 'vts-models-available.json');
    fs.writeFileSync(cachePath, JSON.stringify(models, null, 2), 'utf-8');
    return { count: models.length, cachePath, models };
  }

  async refreshItemsFromVTS() {
    const files = await this.getAvailableItemFiles();
    const cachePath = path.join(path.dirname(this.configPath), 'vts-items-available.json');
    fs.writeFileSync(cachePath, JSON.stringify(files, null, 2), 'utf-8');
    return { count: files.length, cachePath, files };
  }

  // ---------------------------------------------------------------------
  // Ruleta de ÍTEMS — mismo modelo, temporal
  // ---------------------------------------------------------------------

  async spinItemRoulette() {
    const cfg = this.config.itemRoulette;
    const pool = cfg.pool;
    if (!pool || pool.length === 0) {
      throw new Error('itemRoulette.pool está vacío en el config');
    }

    const choice = pool[Math.floor(Math.random() * pool.length)];

    if (this.activeItemTimer) {
      clearTimeout(this.activeItemTimer);
      this.activeItemTimer = null;
    }
    if (this.activeItemInstanceId) {
      await this._unloadItem(this.activeItemInstanceId);
      this.activeItemInstanceId = null;
    }

    const loadResp = await this._send('ItemLoadRequest', {
      fileName: choice.fileName,
      positionX: cfg.positionX ?? 0,
      positionY: cfg.positionY ?? 0,
      size: cfg.size ?? 0.32,
      rotation: 0,
      fadeTime: cfg.fadeTime ?? 0.5,
      order: 1,
      failIfOrderTaken: false,
      smoothing: 0,
      unloadWhenPluginDisconnects: true
    });

    this.activeItemInstanceId = loadResp.instanceID;

    if (cfg.pinToArtMesh) {
      try {
        const artMeshID = await this.findArtMeshID(cfg.pinToArtMesh);
        if (artMeshID) {
          await this._send('ItemPinRequest', {
            pin: true,
            itemInstanceID: this.activeItemInstanceId,
            angleRelativeTo: 'RelativeToWorld',
            sizeRelativeTo: 'RelativeToWorld',
            vertexPinType: 'Center',
            pinInfo: {
              modelID: '',
              artMeshID,
              angle: 0,
              size: cfg.size ?? 0.32,
              vertexID1: 0,
              vertexID2: 0,
              vertexID3: 0,
              vertexWeight1: 1,
              vertexWeight2: 0,
              vertexWeight3: 0
            }
          });
        }
      } catch (e) {
        this.emit('error', new Error(`No se pudo pinear el ítem: ${e.message}`));
      }
    }

    const durationMs = cfg.durationMs ?? 30000;
    this.activeItemTimer = setTimeout(() => {
      this._unloadItem(this.activeItemInstanceId).catch(() => {});
      this.activeItemInstanceId = null;
      this.emit('itemReverted', { fileName: choice.fileName });
    }, durationMs);

    this.emit('itemSpinResult', { fileName: choice.fileName, durationMs });
    return { fileName: choice.fileName, durationMs };
  }

  async findArtMeshID(namePattern) {
    const resp = await this._send('ArtMeshListRequest');
    const names = resp.artMeshNames || [];
    const match = names.find((name) =>
      name.toLowerCase().includes(namePattern.toLowerCase())
    );
    return match || null;
  }

  async _unloadItem(instanceID) {
    if (!instanceID) return;
    try {
      await this._send('ItemUnloadRequest', { itemInstanceIDs: [instanceID] });
    } catch (e) {
      // el ítem puede ya no existir — ignorar
    }
  }

  // ---------------------------------------------------------------------
  // Ruleta de AVATARES — modelo completo, fijo hasta el próximo giro
  // ---------------------------------------------------------------------

  async spinAvatarRoulette() {
    const cfg = this.config.avatarRoulette;
    const pool = cfg.pool;
    if (!pool || pool.length === 0) {
      throw new Error('avatarRoulette.pool está vacío en el config');
    }

    const choice = pool[Math.floor(Math.random() * pool.length)];

    await this._send('ModelLoadRequest', { modelID: choice.modelID });

    this.emit('avatarSpinResult', { name: choice.name, modelID: choice.modelID });
    return { name: choice.name, modelID: choice.modelID };
  }
}

module.exports = VTSClient;
