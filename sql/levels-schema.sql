-- ============================================================
-- MIMIKU — Sistema de Niveles / XP
-- ============================================================
-- XP por canal, separado de los puntos.
--   Puntos = se gastan (economía/tienda)
--   XP     = progresión permanente (estatus, no se gasta)
-- ============================================================

-- ── XP de cada viewer (por canal) ───────────────────────────
CREATE TABLE IF NOT EXISTS viewer_levels (
  id          BIGSERIAL PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  username    TEXT NOT NULL,
  xp          BIGINT NOT NULL DEFAULT 0,        -- XP total acumulado
  level       INTEGER NOT NULL DEFAULT 1,       -- nivel actual (cache)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel_id, username)
);

-- ── Config de XP por canal (el streamer ajusta) ─────────────
CREATE TABLE IF NOT EXISTS level_config (
  channel_id        TEXT PRIMARY KEY,
  xp_per_message    INTEGER NOT NULL DEFAULT 5,   -- XP por mensaje
  xp_per_5min       INTEGER NOT NULL DEFAULT 10,  -- XP cada 5 min viendo
  msg_cooldown_s    INTEGER NOT NULL DEFAULT 30,  -- anti-spam: 1 ganancia por mensaje cada X seg
  level_up_reward   INTEGER NOT NULL DEFAULT 0,   -- puntos de regalo al subir nivel (0 = nada)
  announce_overlay  BOOLEAN NOT NULL DEFAULT true,-- anunciar level-up en overlay
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Títulos / prestigios por nivel ──────────────────────────
-- El streamer puede personalizarlos; estos son los defaults.
CREATE TABLE IF NOT EXISTS level_titles (
  id          BIGSERIAL PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  min_level   INTEGER NOT NULL,                  -- nivel mínimo para este título
  title       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#a1a1aa',
  icon        TEXT NOT NULL DEFAULT '✨',
  UNIQUE(channel_id, min_level)
);

-- RLS off (consistente con el resto)
ALTER TABLE viewer_levels DISABLE ROW LEVEL SECURITY;
ALTER TABLE level_config  DISABLE ROW LEVEL SECURITY;
ALTER TABLE level_titles  DISABLE ROW LEVEL SECURITY;
