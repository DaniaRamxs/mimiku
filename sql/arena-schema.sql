-- ============================================================
-- MIMIKU ARENA — Fase 1: salas + lobby
-- Motor de juegos en tiempo real. Empezamos con "Palabra Bomba".
-- Autoridad: Mimiku Desktop. Sincronización: Supabase Realtime.
-- ============================================================

-- ── SALAS ──────────────────────────────────────────────────
-- Una sala por partida activa. El streamer la crea desde Mimiku.
CREATE TABLE IF NOT EXISTS arena_rooms (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,          -- código corto para unirse (ej: AB4K9)
  channel_id  TEXT NOT NULL,                 -- canal dueño de la sala
  game        TEXT NOT NULL DEFAULT 'palabra_bomba',
  status      TEXT NOT NULL DEFAULT 'lobby', -- lobby | playing | finished
  config      JSONB NOT NULL DEFAULT '{}',   -- categoria, dificultad, recompensa, etc.
  state       JSONB NOT NULL DEFAULT '{}',   -- estado del juego en vivo (turno, palabra, etc.)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arena_rooms_code   ON arena_rooms(code);
CREATE INDEX IF NOT EXISTS idx_arena_rooms_channel ON arena_rooms(channel_id);

-- ── JUGADORES ──────────────────────────────────────────────
-- Cada espectador que entra al lobby de una sala.
CREATE TABLE IF NOT EXISTS arena_players (
  id          BIGSERIAL PRIMARY KEY,
  room_code   TEXT NOT NULL,
  username    TEXT NOT NULL,                 -- login de twitch, o guest_xxxx
  display     TEXT NOT NULL,                 -- nombre visible
  avatar      TEXT DEFAULT '',               -- url avatar (o vacío = inicial)
  is_guest    BOOLEAN NOT NULL DEFAULT false,
  is_ready    BOOLEAN NOT NULL DEFAULT false,
  alive       BOOLEAN NOT NULL DEFAULT true, -- sigue en la partida
  seat        INTEGER NOT NULL DEFAULT 0,    -- posición en el círculo
  placement   INTEGER DEFAULT NULL,          -- puesto final (1=ganador) cuando es eliminado
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_code, username)
);

CREATE INDEX IF NOT EXISTS idx_arena_players_room ON arena_players(room_code);

-- RLS desactivado (igual que el resto de Mimiku por ahora)
ALTER TABLE arena_rooms   DISABLE ROW LEVEL SECURITY;
ALTER TABLE arena_players DISABLE ROW LEVEL SECURITY;
