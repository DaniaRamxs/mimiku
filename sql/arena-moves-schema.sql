-- ============================================================
-- MIMIKU ARENA — Fase 2: jugadas (movimientos)
-- El panel web inserta aquí la palabra del jugador en turno.
-- Mimiku (autoridad) lo escucha por realtime y valida.
-- ============================================================

CREATE TABLE IF NOT EXISTS arena_moves (
  id          BIGSERIAL PRIMARY KEY,
  room_code   TEXT NOT NULL,
  username    TEXT NOT NULL,
  word        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arena_moves_room ON arena_moves(room_code);

ALTER TABLE arena_moves DISABLE ROW LEVEL SECURITY;
