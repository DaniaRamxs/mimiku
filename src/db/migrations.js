const MIGRATIONS = [
  {
    version: 1,
    name: "local_first_schema",
    up: `
      CREATE TABLE IF NOT EXISTS viewer_identities (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        display TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(platform, platform_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_viewer_identity_username
        ON viewer_identities(platform, username);

      CREATE TABLE IF NOT EXISTS wallets (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
        bank_balance INTEGER NOT NULL DEFAULT 0 CHECK(bank_balance >= 0),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id)
      );
      CREATE TABLE IF NOT EXISTS economy_ledger (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id),
        balance_delta INTEGER NOT NULL DEFAULT 0,
        bank_delta INTEGER NOT NULL DEFAULT 0,
        balance_after INTEGER NOT NULL,
        bank_after INTEGER NOT NULL,
        reason TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT '',
        source_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_wallet
        ON economy_ledger(channel_id, viewer_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS viewer_profiles_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        bio TEXT NOT NULL DEFAULT '',
        hours_watched REAL NOT NULL DEFAULT 0,
        frame_url TEXT NOT NULL DEFAULT '',
        banner_url TEXT NOT NULL DEFAULT '',
        badge_url TEXT NOT NULL DEFAULT '',
        name_color TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id)
      );

      CREATE TABLE IF NOT EXISTS mimics_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '✨',
        rarity TEXT NOT NULL DEFAULT 'comun',
        sequence_json TEXT NOT NULL DEFAULT '[]',
        cooldown_s INTEGER NOT NULL DEFAULT 30,
        is_event INTEGER NOT NULL DEFAULT 0,
        asset_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_mimics_channel ON mimics_local(channel_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS mimic_boxes_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '🎁',
        price_points INTEGER,
        price_real REAL,
        mimic_count INTEGER NOT NULL DEFAULT 3,
        odds_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS viewer_mimics_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        mimic_id TEXT NOT NULL REFERENCES mimics_local(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id, mimic_id)
      );
      CREATE TABLE IF NOT EXISTS mimic_uses_local (
        id TEXT PRIMARY KEY,
        request_key TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id),
        mimic_id TEXT NOT NULL REFERENCES mimics_local(id),
        status TEXT NOT NULL DEFAULT 'pending',
        used_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS mimic_gifts_local (
        id TEXT PRIMARY KEY,
        request_key TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL,
        from_viewer_id TEXT REFERENCES viewer_identities(id),
        to_viewer_id TEXT REFERENCES viewer_identities(id),
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS mimic_history_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        viewer_id TEXT REFERENCES viewer_identities(id),
        action TEXT NOT NULL,
        item_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        reference_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS level_config_local (
        channel_id TEXT PRIMARY KEY,
        xp_per_message INTEGER NOT NULL DEFAULT 5,
        xp_per_5min INTEGER NOT NULL DEFAULT 10,
        msg_cooldown_s INTEGER NOT NULL DEFAULT 30,
        level_up_reward INTEGER NOT NULL DEFAULT 0,
        announce_overlay INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS viewer_levels_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        xp INTEGER NOT NULL DEFAULT 0 CHECK(xp >= 0),
        level INTEGER NOT NULL DEFAULT 1 CHECK(level >= 1),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id)
      );
      CREATE TABLE IF NOT EXISTS level_titles_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        min_level INTEGER NOT NULL,
        title TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#a1a1aa',
        icon TEXT NOT NULL DEFAULT '✨'
      );

      CREATE TABLE IF NOT EXISTS cards_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        image_path TEXT NOT NULL DEFAULT '',
        rarity TEXT NOT NULL DEFAULT 'common',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS card_packs_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL CHECK(price >= 0),
        tier TEXT NOT NULL DEFAULT 'normal',
        cards_count INTEGER NOT NULL DEFAULT 3
      );
      CREATE TABLE IF NOT EXISTS viewer_cards_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL REFERENCES cards_local(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        obtained_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id, card_id)
      );
      CREATE TABLE IF NOT EXISTS cosmetics_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        image_path TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL DEFAULT 0 CHECK(price >= 0)
      );
      CREATE TABLE IF NOT EXISTS viewer_cosmetics_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        cosmetic_id TEXT NOT NULL REFERENCES cosmetics_local(id) ON DELETE CASCADE,
        equipped INTEGER NOT NULL DEFAULT 0,
        obtained_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id, cosmetic_id)
      );
      CREATE TABLE IF NOT EXISTS achievements_local (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '🏆',
        condition TEXT NOT NULL,
        threshold REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS viewer_achievements_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        achievement_id TEXT NOT NULL REFERENCES achievements_local(id) ON DELETE CASCADE,
        obtained_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id, achievement_id)
      );

      CREATE TABLE IF NOT EXISTS shop_items_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        item_type TEXT NOT NULL,
        item_ref TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL CHECK(price >= 0),
        active INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS inventory_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL,
        item_ref TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id, item_type, item_ref)
      );
      CREATE TABLE IF NOT EXISTS purchases_local (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id),
        item_id TEXT NOT NULL REFERENCES shop_items_local(id),
        quantity INTEGER NOT NULL,
        unit_price INTEGER NOT NULL,
        total_price INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        purchased_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS redemptions_local (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id),
        reward_type TEXT NOT NULL,
        reward_ref TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS moderation_config_local (
        channel_id TEXT NOT NULL,
        config_key TEXT NOT NULL,
        value_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, config_key)
      );
      CREATE TABLE IF NOT EXISTS mod_sessions_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        viewer_id TEXT REFERENCES viewer_identities(id),
        is_online INTEGER NOT NULL DEFAULT 1,
        last_seen TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS overlay_widgets_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        x INTEGER NOT NULL DEFAULT 50,
        y INTEGER NOT NULL DEFAULT 50,
        w INTEGER NOT NULL DEFAULT 480,
        h INTEGER NOT NULL DEFAULT 300,
        visible INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS arena_config_local (
        channel_id TEXT NOT NULL,
        game TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, game)
      );
      CREATE TABLE IF NOT EXISTS arena_sessions_local (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        game TEXT NOT NULL,
        status TEXT NOT NULL,
        winner_viewer_id TEXT REFERENCES viewer_identities(id),
        started_at TEXT,
        finished_at TEXT,
        summary_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS local_assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source_url TEXT NOT NULL DEFAULT '',
        local_path TEXT NOT NULL,
        checksum TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(kind, source_url)
      );
      CREATE TABLE IF NOT EXISTS import_runs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        report_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS import_records (
        source TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_id TEXT NOT NULL,
        local_table TEXT NOT NULL,
        local_id TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(source, source_table, source_id)
      );
      CREATE TABLE IF NOT EXISTS import_errors (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
        source_table TEXT NOT NULL,
        source_id TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 2,
    name: "viewer_activity_and_local_queues",
    up: `
      CREATE TABLE IF NOT EXISTS viewer_activity_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        messages INTEGER NOT NULL DEFAULT 0 CHECK(messages >= 0),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id)
      );
      CREATE TABLE IF NOT EXISTS cooldowns_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        last_used TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id, action)
      );
      CREATE TABLE IF NOT EXISTS local_outbox (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        processed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_local_outbox_pending ON local_outbox(status, created_at);
    `,
  },
  {
    version: 3,
    name: "tiktok_gifts_and_person_groups",
    // Función en vez de SQL plano: ALTER TABLE ADD COLUMN no admite IF NOT EXISTS,
    // así que se comprueba a mano para que sea seguro sobre bases de beta.
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS persons (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS donations (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          channel_id TEXT NOT NULL,
          viewer_id TEXT NOT NULL REFERENCES viewer_identities(id),
          platform TEXT NOT NULL,
          gift_id TEXT NOT NULL DEFAULT '',
          gift_name TEXT NOT NULL DEFAULT '',
          gift_count INTEGER NOT NULL DEFAULT 1 CHECK(gift_count >= 1),
          coins INTEGER NOT NULL DEFAULT 0 CHECK(coins >= 0),
          points_awarded INTEGER NOT NULL DEFAULT 0 CHECK(points_awarded >= 0),
          month_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_donations_month
          ON donations(channel_id, month_key, viewer_id);
        CREATE TABLE IF NOT EXISTS gift_point_rates (
          channel_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          gift_id TEXT NOT NULL DEFAULT '*',
          points_per_coin REAL NOT NULL CHECK(points_per_coin >= 0),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY(channel_id, platform, gift_id)
        );
        CREATE TABLE IF NOT EXISTS gift_mimic_rules (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          platform TEXT NOT NULL DEFAULT 'tiktok',
          gift_id TEXT NOT NULL DEFAULT '*',
          min_count INTEGER NOT NULL DEFAULT 1 CHECK(min_count >= 1),
          mimic_id TEXT NOT NULL REFERENCES mimics_local(id) ON DELETE CASCADE,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
      const columns = db.prepare("PRAGMA table_info(viewer_identities)").all()
      if (!columns.some(column => column.name === "person_id")) {
        // Preparado para agrupar cuentas en una persona; hoy nada lo lee ni lo escribe.
        db.exec("ALTER TABLE viewer_identities ADD COLUMN person_id TEXT REFERENCES persons(id)")
      }
    },
  },
  {
    version: 4,
    name: "rank_state_and_overrides",
    up: `
      -- Ultimo estado conocido de cada rango por viewer: permite detectar
      -- cuando alguien ENTRA o SALE del rango y anunciarlo una sola vez.
      CREATE TABLE IF NOT EXISTS rank_state (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        rank TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        since TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id, rank)
      );
      -- Asignaciones manuales: pisan el calculo automatico mientras no caduquen.
      CREATE TABLE IF NOT EXISTS rank_overrides (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        rank TEXT NOT NULL,
        effect TEXT NOT NULL DEFAULT 'grant' CHECK(effect IN ('grant', 'deny')),
        expires_at TEXT,
        granted_by TEXT NOT NULL DEFAULT '',
        granted_at TEXT NOT NULL DEFAULT (datetime('now')),
        reason TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_rank_overrides_viewer
        ON rank_overrides(channel_id, viewer_id, rank);
    `,
  },
  {
    version: 5,
    name: "chest_inventory_and_roulette",
    up: `
      -- Inventario de cofres (cajas) SIN abrir por viewer.
      CREATE TABLE IF NOT EXISTS viewer_boxes_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        box_id TEXT NOT NULL REFERENCES mimic_boxes_local(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(channel_id, viewer_id, box_id)
      );
      -- Auditoria e idempotencia de cada entrega de cofres.
      CREATE TABLE IF NOT EXISTS box_grant_history (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id),
        box_id TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity >= 1),
        source TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      -- Registro de giros de la ruleta de cofres; tambien sirve para el cooldown.
      CREATE TABLE IF NOT EXISTS roulette_spins (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id),
        mode TEXT NOT NULL,
        roll INTEGER,
        label TEXT NOT NULL DEFAULT '',
        chests INTEGER NOT NULL,
        box_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_roulette_spins_viewer
        ON roulette_spins(channel_id, viewer_id, created_at DESC);
    `,
  },
  {
    version: 6,
    name: "loyalty_card",
    up: `
      -- Directos detectados por la tarjeta de fidelidad (!claim). Un directo
      -- nuevo empieza tras un hueco sin actividad de chat o a mano desde el panel.
      CREATE TABLE IF NOT EXISTS loyalty_streams (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'auto'
      );
      CREATE INDEX IF NOT EXISTS idx_loyalty_streams_channel
        ON loyalty_streams(channel_id, started_at DESC);
      -- Un sello por viewer y directo: el UNIQUE es la garantia final.
      CREATE TABLE IF NOT EXISTS loyalty_claims (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        stream_id TEXT NOT NULL REFERENCES loyalty_streams(id) ON DELETE CASCADE,
        week_key TEXT NOT NULL,
        stamp_number INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(channel_id, viewer_id, stream_id)
      );
      CREATE INDEX IF NOT EXISTS idx_loyalty_claims_week
        ON loyalty_claims(channel_id, viewer_id, week_key);
      -- Una tarjeta completa por viewer y semana.
      CREATE TABLE IF NOT EXISTS loyalty_completions (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        week_key TEXT NOT NULL,
        reward_points INTEGER NOT NULL,
        delivered_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(channel_id, viewer_id, week_key)
      );
    `,
  },
  {
    version: 7,
    name: "chat_top_counts",
    up: `
      -- Mensajes por viewer en cada directo, para el widget Top 3 del chat.
      -- Va por directo (loyalty_streams), asi se reinicia solo en cada stream.
      CREATE TABLE IF NOT EXISTS chat_top_counts (
        stream_id TEXT NOT NULL REFERENCES loyalty_streams(id) ON DELETE CASCADE,
        viewer_key TEXT NOT NULL,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        display TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        messages INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(stream_id, viewer_key)
      );
      CREATE INDEX IF NOT EXISTS idx_chat_top_counts_rank
        ON chat_top_counts(stream_id, messages DESC, updated_at ASC);
    `,
  },
]

function applyMigrations(db) {
  db.pragma("foreign_keys = ON")
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
  const markApplied = db.prepare("INSERT INTO schema_migrations(version, name) VALUES (?, ?)")
  for (const migration of MIGRATIONS) {
    if (applied.get(migration.version)) continue
    db.transaction(() => {
      if (typeof migration.up === "function") migration.up(db)
      else db.exec(migration.up)
      markApplied.run(migration.version, migration.name)
    })()
  }
  return db
}

module.exports = { MIGRATIONS, applyMigrations }
