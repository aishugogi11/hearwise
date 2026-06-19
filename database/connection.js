const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

let db = null;
let dbType = 'none';

dotenv.config();

// PostgreSQL via DATABASE_URL (Railway, Render Postgres, etc.)
if (!db && process.env.DATABASE_URL) {
  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    pool.on('connect', () => {
      console.log('✅ Connected to PostgreSQL (DATABASE_URL)');
    });

    pool.on('error', (err) => {
      console.error('❌ PostgreSQL error:', err.message);
    });

    db = pool;
    dbType = 'postgresql';
  } catch (err) {
    console.log('⚠️  DATABASE_URL connection failed, falling back to SQLite:', err.message);
  }
}

// PostgreSQL via discrete DB_* vars
if (!db && process.env.DB_HOST && process.env.DB_NAME) {
  try {
    const pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'hearwise',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('connect', () => {
      console.log('✅ Connected to PostgreSQL database');
    });

    pool.on('error', (err) => {
      console.error('❌ PostgreSQL error:', err.message);
    });

    db = pool;
    dbType = 'postgresql';
  } catch (err) {
    console.log('⚠️  PostgreSQL connection failed, falling back to SQLite');
  }
}

// Fallback to SQLite
if (!db) {
  try {
    const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '../data/hearwise.db');
    const dbDir = path.dirname(dbPath);
    
    // Ensure data directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const sqlite = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ SQLite connection failed:', err.message);
      } else {
        console.log('✅ Connected to SQLite database');
      }
    });
    
    // Create tables if they don't exist
    sqlite.serialize(() => {
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          spotify_id TEXT UNIQUE,
          email TEXT UNIQUE,
          display_name TEXT,
          country TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS spotify_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          token_type TEXT DEFAULT 'Bearer',
          scope TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id)
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS listening_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          spotify_track_id TEXT,
          track_name TEXT,
          artist_name TEXT,
          album_name TEXT,
          duration_ms INTEGER,
          listened_duration_ms INTEGER,
          volume_percent INTEGER,
          start_time TEXT,
          end_time TEXT,
          device_type TEXT,
          context_type TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS weekly_listening (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          week_start TEXT NOT NULL,
          week_end TEXT NOT NULL,
          total_minutes REAL,
          total_tracks INTEGER,
          avg_volume_percent REAL,
          avg_db REAL,
          dose_percent REAL,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, week_start)
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS risk_predictions (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          risk_score REAL,
          risk_category TEXT,
          confidence REAL,
          features TEXT,
          model_version TEXT,
          prediction_date TEXT DEFAULT (datetime('now')),
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS hearing_age (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          chronological_age INTEGER,
          hearing_age INTEGER,
          monthly_change INTEGER,
          factors TEXT,
          calculation_date TEXT DEFAULT (date('now')),
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, calculation_date)
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS listening_patterns (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          pattern_type TEXT,
          pattern_name TEXT,
          description TEXT,
          severity TEXT,
          confidence REAL,
          detected_at TEXT DEFAULT (datetime('now')),
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS risk_forecasts (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          forecast_type TEXT,
          forecast_date TEXT,
          predicted_risk_score REAL,
          predicted_risk_category TEXT,
          confidence_interval_lower REAL,
          confidence_interval_upper REAL,
          model_version TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS alerts (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          alert_type TEXT,
          severity TEXT,
          message TEXT,
          is_read INTEGER DEFAULT 0,
          is_dismissed INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS recommendations (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          recommendation_type TEXT,
          title TEXT,
          description TEXT,
          priority TEXT,
          potential_impact REAL,
          is_dismissed INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS user_challenges (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          challenge_id TEXT,
          start_date TEXT,
          end_date TEXT,
          status TEXT DEFAULT 'active',
          current_progress INTEGER DEFAULT 0,
          total_days INTEGER,
          current_wellness_score REAL,
          current_hearing_risk_age INTEGER,
          completed_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS user_achievements (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          achievement_id TEXT,
          earned_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, achievement_id)
        )
      `);
      
      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_listening_sessions_user_id ON listening_sessions(user_id)`);
      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_weekly_listening_user_id ON weekly_listening(user_id)`);
      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_risk_predictions_user_id ON risk_predictions(user_id)`);
      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_hearing_age_user_id ON hearing_age(user_id)`);
      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_forecasts_user_id ON risk_forecasts(user_id)`);
      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id)`);

      // ── COACHING ENGINE TABLES ──────────────────────────────
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS coaching_profiles (
          user_id TEXT PRIMARY KEY,
          xp INTEGER DEFAULT 0,
          level INTEGER DEFAULT 1,
          streak_days INTEGER DEFAULT 0,
          longest_streak INTEGER DEFAULT 0,
          last_checkin_date TEXT,
          last_safe_day TEXT,
          hearing_age_score REAL,
          chronological_age INTEGER DEFAULT 22,
          streak_shields INTEGER DEFAULT 0,
          coach_name TEXT DEFAULT 'Aura',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      sqlite.run(`
        CREATE TABLE IF NOT EXISTS daily_checkins (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          checkin_date TEXT,
          ear_comfort INTEGER,
          breaks_taken TEXT,
          symptoms TEXT,
          coach_response TEXT,
          mission_type TEXT,
          mission_text TEXT,
          mission_target REAL,
          xp_awarded INTEGER DEFAULT 20,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, checkin_date)
        )
      `);

      sqlite.run(`
        CREATE TABLE IF NOT EXISTS daily_missions (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          mission_date TEXT,
          mission_type TEXT,
          mission_text TEXT,
          target_value REAL,
          current_value REAL DEFAULT 0,
          status TEXT DEFAULT 'active',
          xp_reward INTEGER DEFAULT 50,
          completed_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, mission_date)
        )
      `);

      sqlite.run(`
        CREATE TABLE IF NOT EXISTS weekly_challenges (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          week_start TEXT,
          challenge_type TEXT,
          challenge_label TEXT,
          daily_progress TEXT DEFAULT '0000000',
          completed INTEGER DEFAULT 0,
          xp_awarded INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, week_start)
        )
      `);

      sqlite.run(`
        CREATE TABLE IF NOT EXISTS coach_conversations (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          role TEXT,
          message TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      sqlite.run(`
        CREATE TABLE IF NOT EXISTS xp_events (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          xp_amount INTEGER,
          event_type TEXT,
          description TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      sqlite.run(`
        CREATE TABLE IF NOT EXISTS focus_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          preset TEXT,
          focus_minutes INTEGER,
          break_minutes INTEGER,
          focus_score REAL,
          avg_volume REAL,
          peak_volume REAL,
          listening_minutes REAL,
          audio_budget REAL,
          music_context TEXT,
          completed_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      sqlite.run(`
        CREATE TABLE IF NOT EXISTS wellness_snapshots (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          snapshot_date TEXT,
          wellness_score REAL,
          focus_score REAL,
          audio_budget REAL,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, snapshot_date)
        )
      `);

      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_id ON focus_sessions(user_id)`);
      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_wellness_snapshots_user ON wellness_snapshots(user_id, snapshot_date)`);

      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_coaching_profiles_user_id ON coaching_profiles(user_id)`);
      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_daily_checkins_user_id ON daily_checkins(user_id)`);
      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_daily_missions_user_id ON daily_missions(user_id)`);
      sqlite.run(`CREATE INDEX IF NOT EXISTS idx_coach_convos_user_id ON coach_conversations(user_id)`);
    });

    db = sqlite;
    dbType = 'sqlite';
  } catch (err) {
    console.error('❌ SQLite connection failed:', err.message);
  }
}

// If both failed, use in-memory fallback
if (!db) {
  console.log('⚠️  No database available, using in-memory storage');
  db = {
    query: async () => ({ rows: [] }),
    exec: () => {}
  };
  dbType = 'memory';
}

// Wrapper to handle both PostgreSQL and SQLite
class DatabaseWrapper {
  constructor(db, type) {
    this.db = db;
    this.type = type;
  }

  async query(sql, params = []) {
    if (this.type === 'postgresql') {
      const result = await this.db.query(sql, params);
      return result;
    } else if (this.type === 'sqlite') {
      return new Promise((resolve, reject) => {
        this.db.all(sql, params, (err, rows) => {
          if (err) {
            // Try as INSERT/UPDATE/DELETE
            this.db.run(sql, params, function(err2) {
              if (err2) {
                reject(err2);
              } else {
                resolve({ rows: [], rowCount: this.changes });
              }
            });
          } else {
            resolve({ rows: rows || [] });
          }
        });
      });
    } else {
      return { rows: [] };
    }
  }

  async close() {
    if (this.type === 'postgresql') {
      await this.db.end();
    } else if (this.type === 'sqlite') {
      this.db.close();
    }
  }
}

module.exports = new DatabaseWrapper(db, dbType);
console.log(`📊 Database type: ${dbType}`);
