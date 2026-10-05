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
// Pedir token abre un popup en VTube Studio: hay que dar tiempo a que el
// streamer lo vea y pulse "Permitir".
const TOKEN_REQUEST_TIMEOUT_MS = 90000;

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

  _clearToken() {
    try { fs.unlinkSync(this._resolveTokenPath()); } catch (e) { /* no habia token */ }
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
          // Sin autenticar el socket no sirve: se cierra para que el proximo
          // intento empiece limpio.
          this.ws.close();
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

  _send(messageType, data = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
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
      }, timeoutMs);
    });
  }

  async _requestNewToken() {
    const { pluginName, pluginDeveloper } = this.config.connection;
    let tokenResp;
    try {
      tokenResp = await this._send('AuthenticationTokenRequest', { pluginName, pluginDeveloper }, TOKEN_REQUEST_TIMEOUT_MS);
    } catch (err) {
      if (/Timeout/.test(err.message)) {
        throw new Error('VTube Studio no respondió al permiso. Acepta el aviso de "Mimiku" en VTube Studio y vuelve a conectar.');
      }
      if (/error 50:/.test(err.message)) {
        throw new Error('Rechazaste el permiso en VTube Studio. Vuelve a conectar y pulsa "Permitir".');
      }
      throw err;
    }
    this.authToken = tokenResp.authenticationToken;
    this._saveToken(this.authToken);
    return this.authToken;
  }

  async _tryToken(token) {
    const { pluginName, pluginDeveloper } = this.config.connection;
    const authResp = await this._send('AuthenticationRequest', { pluginName, pluginDeveloper, authenticationToken: token });
    return !!authResp.authenticated;
  }

  // Usa el token guardado; si VTube Studio lo rechaza (permiso quitado o VTS
  // reinstalado), lo descarta y pide uno nuevo, lo que abre el aviso en VTS.
  async _authenticate() {
    this.authToken = this._loadToken();
    let ok = this.authToken ? await this._tryToken(this.authToken) : false;

    if (!ok) {
      if (this.authToken) {
        this._clearToken();
        this.emit('tokenRejected');
      }
      await this._requestNewToken();
      ok = await this._tryToken(this.authToken);
    }

    if (!ok) {
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
      await this._send('ItemUnloadRequest', { instanceIDs: [instanceID] });
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

  // ---------------------------------------------------------------------
  // Reacciones VTuber: atajos, color, movimiento y parametros
  // ---------------------------------------------------------------------

  // Atajos del modelo cargado: expresiones, animaciones, cambios de ropa...
  async getHotkeys() {
    const resp = await this._send('HotkeysInCurrentModelRequest', {});
    return (resp.availableHotkeys || []).map((hotkey) => ({
      id: hotkey.hotkeyID, name: hotkey.name || hotkey.hotkeyID, type: hotkey.type || ''
    }));
  }

  triggerHotkey(hotkeyID) {
    return this._send('HotkeyTriggerRequest', { hotkeyID });
  }

  // Tine todo el modelo. Blanco opaco (255,255,255,255) es "sin tinte".
  tintModel({ r, g, b, a = 255, rainbow = false }) {
    return this._send('ColorTintRequest', {
      colorTint: { colorR: r, colorG: g, colorB: b, colorA: a, jeb_: rainbow },
      artMeshMatcher: { tintAll: true }
    });
  }

  // Movimiento relativo a donde esta el modelo; los valores en 0 no se mandan
  // para no tocar lo que no se mueve.
  moveModel({ seconds, x = 0, y = 0, rotation = 0, size = 0 }) {
    const data = { timeInSeconds: seconds, valuesAreRelativeToModel: true };
    if (x) data.positionX = x;
    if (y) data.positionY = y;
    if (rotation) data.rotation = rotation;
    if (size) data.size = size;
    return this._send('MoveModelRequest', data);
  }

  // Parametro propio del plugin; si ya existe, VTS solo lo actualiza.
  createParameter({ name, explanation = '', min = 0, max = 1, defaultValue = 0 }) {
    return this._send('ParameterCreationRequest', { parameterName: name, explanation, min, max, defaultValue });
  }

  // VTube Studio suelta el control de un parametro si no se reinyecta en ~1 s.
  injectParameters(values) {
    return this._send('InjectParameterDataRequest', {
      faceFound: false,
      mode: 'set',
      parameterValues: values.map(({ id, value }) => ({ id, value }))
    });
  }

  // Expresiones del modelo (archivos .exp3.json).
  async getExpressions() {
    const resp = await this._send('ExpressionStateRequest', { details: false });
    return (resp.expressions || []).map((expression) => ({ file: expression.file, name: expression.name || expression.file }));
  }

  setExpression(expressionFile, active) {
    return this._send('ExpressionActivationRequest', { expressionFile, active: !!active, fadeTime: 0.25 });
  }

  async getArtMeshes() {
    const resp = await this._send('ArtMeshListRequest');
    return resp.artMeshNames || [];
  }

  // Carga una imagen propia (base64) como item. Con askFirst, VTube Studio
  // pregunta al streamer la primera vez que ve esa imagen; mientras tanto
  // esta peticion no responde, de ahi el plazo largo.
  async loadCustomItem({ fileName, base64, size, x = 0, y = 0.5, order, askFirst = false }) {
    const resp = await this._send('ItemLoadRequest', {
      fileName,
      positionX: x,
      positionY: y,
      size,
      rotation: 0,
      fadeTime: 0.3,
      order,
      failIfOrderTaken: false,
      smoothing: 0,
      censored: false,
      flipped: false,
      locked: false,
      unloadWhenPluginDisconnects: true,
      customDataBase64: base64,
      customDataAskUserFirst: askFirst,
      customDataSkipAskingUserIfWhitelisted: true,
      customDataAskTimer: askFirst ? 30 : -1
    }, askFirst ? 40000 : REQUEST_TIMEOUT_MS);
    return resp.instanceID;
  }

  // artMeshID vacio = una parte cualquiera del modelo. Random = un punto
  // cualquiera de esa parte; Center = siempre el mismo.
  pinItem({ instanceID, artMeshID = '', random = true, size }) {
    return this._send('ItemPinRequest', {
      pin: true,
      itemInstanceID: instanceID,
      angleRelativeTo: 'RelativeToModel',
      sizeRelativeTo: 'RelativeToWorld',
      vertexPinType: random ? 'Random' : 'Center',
      pinInfo: { modelID: '', artMeshID, angle: 0, size }
    });
  }

  unloadItems(instanceIDs) {
    if (!instanceIDs.length) return Promise.resolve(null);
    return this._send('ItemUnloadRequest', { instanceIDs, allowUnloadingItemsLoadedByUserOrOtherPlugins: false });
  }

  // Fuerza (0-100) y viento (0-100) de la fisica del modelo; VTS los suelta
  // solos tras overrideSeconds (0.5-5 s), hay que repetirlo para mantenerlos.
  setPhysics({ strength, wind, seconds = 5 }) {
    const override = (value) => [{ id: '', value, setBaseValue: true, overrideSeconds: seconds }];
    return this._send('SetCurrentModelPhysicsRequest', {
      strengthOverrides: override(strength),
      windOverrides: override(wind)
    });
  }
}

module.exports = VTSClient;
