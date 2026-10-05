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
  {
    version: 8,
    name: "gacha_market_trades",
    up: `
      -- Mercado del gachapon a precio fijo. Al publicar, la carta sale de la
      -- coleccion del vendedor y queda retenida aqui hasta que se vende
      -- (pasa al comprador) o se retira (vuelve al vendedor).
      CREATE TABLE IF NOT EXISTS gacha_listings (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        seller_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL REFERENCES cards_local(id) ON DELETE CASCADE,
        price INTEGER NOT NULL CHECK(price > 0),
        fee INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'sold', 'cancelled')),
        buyer_id TEXT REFERENCES viewer_identities(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_gacha_listings_open ON gacha_listings(channel_id, status, created_at);
      -- Ofertas de tradeo entre viewers. Lo ofrecido NO se retiene: al aceptar
      -- se comprueba que ambos siguen teniendo todo y se mueve en una transaccion.
      -- give_json / want_json: {"cards":[{"id":"...","qty":1}],"points":0}
      CREATE TABLE IF NOT EXISTS gacha_trades (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        from_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        to_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        give_json TEXT NOT NULL,
        want_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'accepted', 'rejected', 'cancelled', 'expired', 'failed')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_gacha_trades_to ON gacha_trades(channel_id, to_id, status);
      CREATE INDEX IF NOT EXISTS idx_gacha_trades_from ON gacha_trades(channel_id, from_id, status);
    `,
  },
  {
    version: 9,
    name: "viewer_effects",
    up: `
      -- Efectos temporales comprados en la tienda de efectos de la pagina de
      -- canje (ej: inmunidad a !robarpj). Una fila por viewer y efecto; comprar
      -- otra vez alarga expires_at (ISO).
      CREATE TABLE IF NOT EXISTS viewer_effects_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        effect_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, viewer_id, effect_id)
      );
    `,
  },
  {
    version: 10,
    name: "battle_pass_and_card_sleeves",
    up: `
      -- Fundas puestas: cuantas copias de una carta llevan cada tipo de funda
      -- (rara, epica, prisma). La suma nunca pasa de viewer_cards_local.quantity.
      -- Robar, regalar y forjar solo usan copias sin funda; una copia con funda
      -- solo se mueve si se elige al vender o tradear, y viaja con su funda.
      CREATE TABLE IF NOT EXISTS viewer_card_sleeves (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL,
        sleeve TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        PRIMARY KEY (channel_id, viewer_id, card_id, sleeve)
      );
      ALTER TABLE gacha_listings ADD COLUMN sleeve TEXT;
      -- Fundas ganadas que todavia no se han puesto en ninguna carta.
      CREATE TABLE IF NOT EXISTS viewer_sleeves_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        sleeve TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        PRIMARY KEY (channel_id, viewer_id, sleeve)
      );
      -- Pase de batalla por temporadas. La experiencia del pase va aparte del
      -- nivel normal y empieza en 0 cada temporada.
      CREATE TABLE IF NOT EXISTS battle_pass_seasons (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        name TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_battle_pass_seasons_channel ON battle_pass_seasons(channel_id, starts_at);
      CREATE TABLE IF NOT EXISTS battle_pass_progress (
        season_id TEXT NOT NULL REFERENCES battle_pass_seasons(id) ON DELETE CASCADE,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        xp INTEGER NOT NULL DEFAULT 0,
        premium INTEGER NOT NULL DEFAULT 0,
        premium_at TEXT,
        PRIMARY KEY (season_id, viewer_id)
      );
      -- Premios ya entregados (uno por nivel y pista). Los manuales (cofres de
      -- Streamloots) quedan con delivered_at NULL hasta que el streamer los marca.
      CREATE TABLE IF NOT EXISTS battle_pass_rewards (
        season_id TEXT NOT NULL REFERENCES battle_pass_seasons(id) ON DELETE CASCADE,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        level INTEGER NOT NULL,
        track TEXT NOT NULL CHECK(track IN ('free', 'premium')),
        reward_json TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        manual INTEGER NOT NULL DEFAULT 0,
        delivered_at TEXT,
        PRIMARY KEY (season_id, viewer_id, level, track)
      );
    `,
  },
  {
    version: 11,
    name: "activity_log_and_weekly_missions",
    up: `
      -- Lo que hace cada viewer (mensajes, minutos viendo, bolas de Plinko,
      -- tiradas, cofres abiertos, Mimics lanzados, mercado/tradeos, forja).
      -- Lo usan las misiones semanales del pase; se borra lo de mas de 35 dias.
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL,
        action TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_viewer ON activity_log(channel_id, viewer_id, action, created_at);
      -- Misiones semanales ya reclamadas (una vez por semana y mision).
      CREATE TABLE IF NOT EXISTS battle_pass_mission_claims (
        season_id TEXT NOT NULL REFERENCES battle_pass_seasons(id) ON DELETE CASCADE,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        week_key TEXT NOT NULL,
        mission_id TEXT NOT NULL,
        xp INTEGER NOT NULL,
        claimed_at TEXT NOT NULL,
        PRIMARY KEY (season_id, viewer_id, week_key, mission_id)
      );
    `,
  },
  {
    version: 12,
    name: "card_variants_rank_and_sleeve",
    up: `
      -- Copias especiales de una carta: con rango subido (rank: raro, epico,
      -- legendario, mitico; '' = el de base) y/o con funda (sleeve; '' = sin
      -- funda). Las copias normales son quantity de viewer_cards_local menos la
      -- suma de estas filas. Sustituye a viewer_card_sleeves (se copian sus filas).
      CREATE TABLE IF NOT EXISTS viewer_card_variants (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL,
        rank TEXT NOT NULL DEFAULT '',
        sleeve TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        PRIMARY KEY (channel_id, viewer_id, card_id, rank, sleeve)
      );
      INSERT OR IGNORE INTO viewer_card_variants(channel_id, viewer_id, card_id, rank, sleeve, quantity)
        SELECT channel_id, viewer_id, card_id, '', sleeve, quantity FROM viewer_card_sleeves WHERE quantity > 0;
      DROP TABLE IF EXISTS viewer_card_sleeves;
      ALTER TABLE gacha_listings ADD COLUMN rank TEXT;
    `,
  },
  {
    version: 13,
    name: "sub_pass",
    up: `
      -- Personajes exclusivos: 'sub' = solo salen en el Pase Sub (no en el
      -- gachapon, el Plinko, la forja ni el pase normal).
      ALTER TABLE cards_local ADD COLUMN exclusive TEXT NOT NULL DEFAULT '';
      -- Tiradas de gachapon y bolas de Plinko gratis (se gastan antes que los puntos).
      CREATE TABLE IF NOT EXISTS viewer_tickets_local (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        PRIMARY KEY (channel_id, viewer_id, kind)
      );
      -- Suscripcion de Twitch comprobada con la API al entrar en la pagina de canje.
      CREATE TABLE IF NOT EXISTS viewer_twitch_subs (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        tier TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        valid_until TEXT NOT NULL,
        PRIMARY KEY (channel_id, viewer_id)
      );
      -- Pase Sub: progreso y premios por temporada (misma temporada que el pase normal).
      CREATE TABLE IF NOT EXISTS sub_pass_progress (
        season_id TEXT NOT NULL REFERENCES battle_pass_seasons(id) ON DELETE CASCADE,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        xp INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (season_id, viewer_id)
      );
      CREATE TABLE IF NOT EXISTS sub_pass_rewards (
        season_id TEXT NOT NULL REFERENCES battle_pass_seasons(id) ON DELETE CASCADE,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        level INTEGER NOT NULL,
        reward_json TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        PRIMARY KEY (season_id, viewer_id, level)
      );
    `,
  },
  {
    version: 14,
    name: "mission_rerolls",
    up: `
      -- Misiones renovadas pagando puntos: cuantas veces esta semana y cuando fue la ultima.
      CREATE TABLE IF NOT EXISTS battle_pass_mission_rerolls (
        season_id TEXT NOT NULL REFERENCES battle_pass_seasons(id) ON DELETE CASCADE,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        week_key TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        last_at TEXT NOT NULL,
        PRIMARY KEY (season_id, viewer_id, week_key)
      );
    `,
  },
  {
    version: 15,
    name: "reward_choices",
    up: `
      -- Premios a elegir del Pase Sub: kind 'pick' (elige un personaje de esa
      -- rarity) o 'mythic' (convierte una carta tuya en mitica). Se usan cuando
      -- el viewer quiera; al usarlos quedan used_at y card_id.
      CREATE TABLE IF NOT EXISTS viewer_reward_choices (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('pick', 'mythic')),
        rarity TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        used_at TEXT,
        card_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_reward_choices_viewer ON viewer_reward_choices(channel_id, viewer_id, used_at);
      -- Nivel extra del Pase Sub (cofres de Streamloots que entrega el streamer):
      -- queda pendiente hasta que se marca como entregado en el panel.
      ALTER TABLE sub_pass_rewards ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sub_pass_rewards ADD COLUMN delivered_at TEXT;
    `,
  },
  {
    version: 16,
    name: "minigames",
    up: `
      -- Partidas por pasos (alta o baja, buscaminas): la apuesta se cobra al
      -- empezar y state_json guarda lo que el viewer no debe ver (minas, cartas).
      CREATE TABLE IF NOT EXISTS minigame_sessions (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        game TEXT NOT NULL,
        bet INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'lost', 'cashed')),
        payout INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_minigame_sessions_viewer ON minigame_sessions(channel_id, viewer_id, game, status);
      -- Giros gratis diarios (ruleta): uno por viewer y dia (fecha local).
      CREATE TABLE IF NOT EXISTS minigame_free_spins (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        game TEXT NOT NULL,
        day_key TEXT NOT NULL,
        PRIMARY KEY (channel_id, viewer_id, game, day_key)
      );
    `,
  },
  {
    version: 17,
    name: "support_donations",
    up: `
      -- Aportes de apoyo al proyecto (propinas de StreamElements, etc.) que el
      -- streamer apunta a mano. Dan puntos y forman el top de donadores de la
      -- pagina de canje. Deshacer un aporte lo marca (undone_at), no lo borra.
      CREATE TABLE IF NOT EXISTS support_donations (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        points INTEGER NOT NULL CHECK(points >= 0),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        undone_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_support_donations_viewer ON support_donations(channel_id, viewer_id);
    `,
  },
  {
    version: 18,
    name: "viewer_profiles",
    up: `
      -- Perfiles de la pagina de canje: se crea al entrar por primera vez en la
      -- web (asi la seccion Comunidad solo muestra a quien la usa). Guarda el
      -- banner y el marco equipados y la vitrina de personajes favoritos
      -- (JSON con {id, rank, sleeve} de cada carta, en orden).
      CREATE TABLE IF NOT EXISTS viewer_profiles (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        banner TEXT NOT NULL DEFAULT '',
        frame TEXT NOT NULL DEFAULT '',
        showcase TEXT NOT NULL DEFAULT '[]',
        joined_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, viewer_id)
      );
      CREATE INDEX IF NOT EXISTS idx_viewer_profiles_seen ON viewer_profiles(channel_id, last_seen_at);
      -- Banners y marcos comprados en la tienda de perfil (son para siempre).
      CREATE TABLE IF NOT EXISTS viewer_cosmetics (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        cosmetic_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, viewer_id, cosmetic_id)
      );
    `,
  },
  {
    version: 19,
    name: "gacha_pity",
    up: `
      -- Garantia del gachapon: tiradas seguidas sin legendario de cada viewer.
      -- Al llegar al limite (gachapon.js PITY_LIMIT) la tirada es legendaria
      -- y el contador vuelve a 0 (tambien si el legendario sale por suerte).
      CREATE TABLE IF NOT EXISTS gacha_pity (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL REFERENCES viewer_identities(id) ON DELETE CASCADE,
        pulls INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, viewer_id)
      );
    `,
  },
  {
    version: 20,
    name: "loyalty_reward_100k",
    up: `
      -- La tarjeta de fidelidad semanal pasa a premiar 100.000 puntos (antes
      -- 20.000 por defecto). Solo se sube donde seguia el valor antiguo: si el
      -- streamer puso otra cantidad a mano, se respeta.
      UPDATE moderation_config_local
        SET value_json = json_set(value_json, '$.rewardPoints', 100000)
        WHERE config_key = 'loyalty' AND json_extract(value_json, '$.rewardPoints') = 20000;
    `,
  },
  {
    version: 21,
    name: "external_tips",
    up: `
      -- Propinas que llegan solas de servicios externos (StreamElements). El id
      -- es el del servicio: la misma propina nunca se apunta dos veces.
      -- status: applied (ya es un aporte), pending (falta asignarla) o dismissed.
      CREATE TABLE IF NOT EXISTS external_tips (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        source TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        message TEXT NOT NULL DEFAULT '',
        tipped_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        donation_id TEXT,
        viewer_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_external_tips_status ON external_tips(channel_id, status, tipped_at);
    `,
  },
  {
    version: 22,
    name: "community_achievements",
    up: `
      -- Contadores de por vida de cada viewer para los logros (community.js).
      CREATE TABLE IF NOT EXISTS viewer_stats (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL,
        stat TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (channel_id, viewer_id, stat)
      );
      -- Logros desbloqueados. seen=0 hasta que la pagina avisa al viewer.
      CREATE TABLE IF NOT EXISTS viewer_achievements (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        unlocked_at TEXT NOT NULL,
        seen INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (channel_id, viewer_id, achievement_id)
      );
    `,
  },
  {
    version: 23,
    name: "posts_mailbox",
    up: `
      -- Posts y Novedades de la streamer (canje-posts.js). kind: post | update;
      -- audience: all | subs. reward_points: regalo que se reclama en el Buzon.
      CREATE TABLE IF NOT EXISTS canje_posts (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        audience TEXT NOT NULL DEFAULT 'all',
        reward_points INTEGER NOT NULL DEFAULT 0,
        reward_audience TEXT NOT NULL DEFAULT 'all',
        author TEXT NOT NULL DEFAULT '',
        request_key TEXT,
        published_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_canje_posts_feed ON canje_posts(channel_id, kind, published_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_canje_posts_key ON canje_posts(channel_id, request_key);
      -- Un regalo por persona y publicacion.
      CREATE TABLE IF NOT EXISTS canje_post_claims (
        channel_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL,
        points INTEGER NOT NULL,
        claimed_at TEXT NOT NULL,
        PRIMARY KEY (post_id, viewer_id)
      );
      -- Ultima vez que el viewer abrio el Buzon (lo de despues es "sin leer").
      CREATE TABLE IF NOT EXISTS viewer_mailbox (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, viewer_id)
      );
    `,
  },
  {
    version: 24,
    name: "post_views_likes",
    up: `
      -- Vistas (personas distintas que lo vieron) y likes de posts y novedades.
      CREATE TABLE IF NOT EXISTS canje_post_views (
        post_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL,
        viewed_at TEXT NOT NULL,
        PRIMARY KEY (post_id, viewer_id)
      );
      CREATE TABLE IF NOT EXISTS canje_post_likes (
        post_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL,
        liked_at TEXT NOT NULL,
        PRIMARY KEY (post_id, viewer_id)
      );
    `,
  },
  {
    version: 25,
    name: "post_comments",
    up: `
      -- Comentarios de posts y novedades. deleted_by: author | streamer.
      CREATE TABLE IF NOT EXISTS canje_post_comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL,
        body TEXT NOT NULL,
        request_key TEXT UNIQUE,
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_canje_post_comments ON canje_post_comments(post_id, created_at);
      -- Viewers silenciados por la streamer: no pueden comentar.
      CREATE TABLE IF NOT EXISTS canje_comment_mutes (
        channel_id TEXT NOT NULL,
        viewer_id TEXT NOT NULL,
        muted_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, viewer_id)
      );
    `,
  },
  {
    version: 26,
    name: "duels",
    up: `
      -- Duelos entre viewers (canje-duels.js). status: drafting (quien reta
      -- juega su mano), open (esperando al rival), playing (el rival juega),
      -- done, declined, cancelled, expired. winner: challenger | opponent | push.
      CREATE TABLE IF NOT EXISTS canje_duels (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        game TEXT NOT NULL,
        challenger_id TEXT NOT NULL,
        opponent_id TEXT NOT NULL,
        bet INTEGER NOT NULL,
        status TEXT NOT NULL,
        challenger_json TEXT NOT NULL DEFAULT '{}',
        opponent_json TEXT NOT NULL DEFAULT '{}',
        winner TEXT,
        payout INTEGER NOT NULL DEFAULT 0,
        fee INTEGER NOT NULL DEFAULT 0,
        request_key TEXT UNIQUE,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        accepted_at TEXT,
        resolved_at TEXT,
        challenger_seen INTEGER NOT NULL DEFAULT 0,
        opponent_seen INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_canje_duels_challenger ON canje_duels(channel_id, challenger_id, status);
      CREATE INDEX IF NOT EXISTS idx_canje_duels_opponent ON canje_duels(channel_id, opponent_id, status);
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
