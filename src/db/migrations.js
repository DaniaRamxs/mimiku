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
      db.exec(migration.up)
      markApplied.run(migration.version, migration.name)
    })()
  }
  return db
}

module.exports = { MIGRATIONS, applyMigrations }
