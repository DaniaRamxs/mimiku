-- ============================================================
-- MIMIKU — Sistema de Mimics
-- ============================================================
-- Mimics = SECUENCIAS DE ACCIONES programables (comprar momentos)
-- Cartas = coleccionables (coexisten, no se reemplazan)
-- ============================================================

-- ── 1. MIMICS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mimics (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  channel_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT '✨',
  rarity      TEXT NOT NULL DEFAULT 'comun',
  sequence    JSONB NOT NULL DEFAULT '[]',
  cooldown_s  INTEGER NOT NULL DEFAULT 30,
  active      BOOLEAN NOT NULL DEFAULT true,
  is_event    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. CAJAS DE MIMICS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS mimic_boxes (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  channel_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  icon         TEXT NOT NULL DEFAULT '🎁',
  price_real   NUMERIC(10,2),
  price_points INTEGER,
  mimic_count  INTEGER NOT NULL DEFAULT 3,
  odds         JSONB NOT NULL DEFAULT '{"comun":60,"raro":25,"epico":12,"legendario":3}',
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. INVENTARIO DE MIMICS DEL VIEWER ──────────────────────
CREATE TABLE IF NOT EXISTS viewer_mimics (
  id          BIGSERIAL PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  username    TEXT NOT NULL,
  mimic_id    TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel_id, username, mimic_id)
);

-- ── 4. USOS DE MIMICS (cola de ejecución) ───────────────────
CREATE TABLE IF NOT EXISTS mimic_uses (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  channel_id  TEXT NOT NULL,
  username    TEXT NOT NULL,
  display     TEXT NOT NULL DEFAULT '',
  mimic_id    TEXT NOT NULL,
  message     TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  used_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. REGALOS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mimic_gifts (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  channel_id  TEXT NOT NULL,
  from_user   TEXT NOT NULL,
  to_user     TEXT,
  gift_type   TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT 'user',
  target_n    INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 6. MIMIKU PLUS (suscripciones) ──────────────────────────
CREATE TABLE IF NOT EXISTS mimiku_plus (
  id                 BIGSERIAL PRIMARY KEY,
  channel_id         TEXT NOT NULL,
  username           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  stripe_sub_id      TEXT,
  current_period_end TIMESTAMPTZ,
  free_box_claimed_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel_id, username)
);

-- ── 7. TRANSACCIONES (dinero real) ──────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  channel_id        TEXT NOT NULL,
  username          TEXT NOT NULL,
  type              TEXT NOT NULL,
  item_id           TEXT,
  amount_real       NUMERIC(10,2) NOT NULL,
  streamer_cut      NUMERIC(10,2) NOT NULL,
  mimiku_cut        NUMERIC(10,2) NOT NULL,
  stripe_payment_id TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 8. CUENTAS STRIPE DE STREAMERS ──────────────────────────
CREATE TABLE IF NOT EXISTS streamer_payouts (
  channel_id          TEXT PRIMARY KEY,
  stripe_account_id   TEXT,
  onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  payout_enabled      BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RLS deshabilitado ──
ALTER TABLE mimics            DISABLE ROW LEVEL SECURITY;
ALTER TABLE mimic_boxes       DISABLE ROW LEVEL SECURITY;
ALTER TABLE viewer_mimics     DISABLE ROW LEVEL SECURITY;
ALTER TABLE mimic_uses        DISABLE ROW LEVEL SECURITY;
ALTER TABLE mimic_gifts       DISABLE ROW LEVEL SECURITY;
ALTER TABLE mimiku_plus       DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE streamer_payouts  DISABLE ROW LEVEL SECURITY;

-- ── Realtime para la cola de ejecución ──
ALTER TABLE mimic_uses REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE mimic_uses;
