const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

// Agregar nav item
c = c.replace(
  '    <button class="nav-item" data-page="settings">⚙ Ajustes</button>',
  '    <button class="nav-item" data-page="cards">🃏 Cartas</button>\n    <button class="nav-item" data-page="settings">⚙ Ajustes</button>'
)

// Agregar página de cartas antes de settings
const cardsPage = `
    <!-- Cartas -->
    <div id="cards" class="page">
      <div class="page-header"><h1>Cartas y Sobres</h1></div>

      <div class="two-col" style="align-items:start">

        <!-- Cartas -->
        <div>
          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">🃏 Crear carta</span>
            </div>
            <div class="form-group">
              <label>Nombre<input id="card-name" type="text" placeholder="Carta épica del canal"></label>
              <label>Descripción<input id="card-desc" type="text" placeholder="Una carta muy especial..."></label>
              <label>URL de imagen<input id="card-img" type="url" placeholder="https://...jpg"></label>
              <label>Rareza
                <select id="card-rarity" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text-primary);font-size:13px;outline:none">
                  <option value="common">Común</option>
                  <option value="rare">Raro</option>
                  <option value="epic">Épico</option>
                  <option value="legendary">Legendario</option>
                </select>
              </label>
              <button class="btn-primary" onclick="window.cardsPage.createCard()">Crear carta</button>
            </div>
          </div>

          <div class="panel" style="margin-top:1rem">
            <div class="panel-header">
              <span class="panel-title">Cartas del canal</span>
              <button class="btn-ghost" onclick="window.cardsPage.loadCards()">↻</button>
            </div>
            <div id="cards-list"><p class="empty">Cargando…</p></div>
          </div>
        </div>

        <!-- Sobres -->
        <div>
          <div class="panel">
            <div class="panel-header"><span class="panel-title">📦 Crear sobre</span></div>
            <div class="form-group">
              <label>Nombre<input id="pack-name" type="text" placeholder="Sobre Básico"></label>
              <label>Descripción<input id="pack-desc" type="text" placeholder="3 cartas aleatorias"></label>
              <label>Precio (puntos)<input id="pack-price" type="number" placeholder="200" min="1"></label>
              <label>Tier
                <select id="pack-tier" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text-primary);font-size:13px;outline:none">
                  <option value="basic">Básico (común/raro predomina)</option>
                  <option value="premium">Premium (épico/legendario predomina)</option>
                </select>
              </label>
              <button class="btn-primary" onclick="window.cardsPage.createPack()">Crear sobre</button>
            </div>
          </div>

          <div class="panel" style="margin-top:1rem">
            <div class="panel-header">
              <span class="panel-title">Sobres del canal</span>
              <button class="btn-ghost" onclick="window.cardsPage.loadPacks()">↻</button>
            </div>
            <div id="packs-list"><p class="empty">Cargando…</p></div>
          </div>
        </div>

      </div>
    </div>

`

c = c.replace('    <!-- Ajustes -->', cardsPage + '    <!-- Ajustes -->')

fs.writeFileSync('src/index.html', c)
console.log('cards page:', c.includes('Cartas y Sobres'))
