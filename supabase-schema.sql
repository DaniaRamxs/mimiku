-- EJECUTAR EN: Supabase Dashboard → SQL Editor
-- Plantilla heredada: ejecutarla únicamente en un proyecto del streamer.

-- ── Canales registrados ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,        -- twitch login del broadcaster
  display     TEXT NOT NULL DEFAULT '',
  avatar_url  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Sesiones de mods activos ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mod_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  mod_username TEXT NOT NULL,
  mod_display  TEXT NOT NULL DEFAULT '',
  mod_avatar   TEXT NOT NULL DEFAULT '',
  is_online    BOOLEAN NOT NULL DEFAULT true,
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- índice para buscar mods por canal rápido
CREATE INDEX IF NOT EXISTS idx_mod_sessions_channel ON mod_sessions(channel_id);

-- ── Comandos de overlay en tiempo real ────────────────────────────────────
CREATE TABLE IF NOT EXISTS overlay_commands (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  mod_username TEXT NOT NULL,
  mod_display  TEXT NOT NULL DEFAULT '',
  type         TEXT NOT NULL,   -- 'url' | 'text' | 'image' | 'alert' | 'clear'
  payload      JSONB NOT NULL DEFAULT '{}',
  widget_id    TEXT NOT NULL DEFAULT '',   -- id único del widget en overlay
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overlay_commands_channel ON overlay_commands(channel_id);

-- ── AFK sessions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS afk_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  is_active   BOOLEAN NOT NULL DEFAULT false,
  message     TEXT NOT NULL DEFAULT 'AFK — Volvemos pronto ✦',
  started_at  TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ
);

-- ── Habilitar Realtime en las tablas que lo necesitan ─────────────────────
ALTER TABLE overlay_commands REPLICA IDENTITY FULL;
ALTER TABLE afk_sessions     REPLICA IDENTITY FULL;
ALTER TABLE mod_sessions     REPLICA IDENTITY FULL;
