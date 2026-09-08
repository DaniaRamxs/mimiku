-- ============================================================
-- MIMIKU — Inventario de cajas sin abrir
-- ============================================================
-- Las cajas ahora van al inventario primero; el viewer las abre cuando quiera.
-- Permite regalar cajas sin abrir a la comunidad.
-- ============================================================

CREATE TABLE IF NOT EXISTS viewer_boxes (
  id          BIGSERIAL PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  username    TEXT NOT NULL,
  box_id      TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel_id, username, box_id)
);

ALTER TABLE viewer_boxes DISABLE ROW LEVEL SECURITY;

-- Ampliar mimic_gifts para regalos de cajas a la comunidad
-- (ya tiene gift_type='box', target, target_n — solo agregamos quantity)
ALTER TABLE mimic_gifts ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;
