-- HearWise Database Schema
-- PostgreSQL database schema for hearing health platform

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id VARCHAR(255) UNIQUE,
  email VARCHAR(255) UNIQUE,
  display_name VARCHAR(255),
  country VARCHAR(2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Spotify tokens table
CREATE TABLE IF NOT EXISTS spotify_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type VARCHAR(50) DEFAULT 'Bearer',
  expires_at TIMESTAMP,
  scope TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

-- Listening sessions table
CREATE TABLE IF NOT EXISTS listening_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  spotify_track_id VARCHAR(255),
  track_name VARCHAR(500),
  artist_name VARCHAR(500),
  album_name VARCHAR(500),
  duration_ms INTEGER,
  listened_duration_ms INTEGER,
  volume_percent INTEGER,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  device_type VARCHAR(100),
  context_type VARCHAR(100), -- album, playlist, artist, etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Weekly listening aggregates table
CREATE TABLE IF NOT EXISTS weekly_listening (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_minutes DECIMAL(10,2),
  total_tracks INTEGER,
  avg_volume_percent DECIMAL(5,2),
  avg_db DECIMAL(5,2),
  dose_percent DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, week_start)
);

-- Risk predictions table
CREATE TABLE IF NOT EXISTS risk_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  risk_score DECIMAL(5,2),
  risk_category VARCHAR(50),
  confidence DECIMAL(5,2),
  model_version VARCHAR(50),
  features JSONB,
  prediction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Hearing age calculations table
CREATE TABLE IF NOT EXISTS hearing_age (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  chronological_age INTEGER,
  hearing_age INTEGER,
  monthly_change INTEGER,
  factors JSONB,
  calculation_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, calculation_date)
);

-- User survey responses table
CREATE TABLE IF NOT EXISTS user_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  survey_type VARCHAR(100),
  responses JSONB,
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Recommendations table
CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  recommendation_type VARCHAR(100),
  title VARCHAR(500),
  description TEXT,
  priority VARCHAR(50),
  potential_impact DECIMAL(5,2),
  is_dismissed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Listening patterns table
CREATE TABLE IF NOT EXISTS listening_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  pattern_type VARCHAR(100),
  pattern_name VARCHAR(255),
  description TEXT,
  severity VARCHAR(50),
  confidence DECIMAL(5,2),
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Forecasts table
CREATE TABLE IF NOT EXISTS risk_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  forecast_type VARCHAR(50), -- 30-day, 90-day
  forecast_date DATE,
  predicted_risk_score DECIMAL(5,2),
  predicted_risk_category VARCHAR(50),
  confidence_interval_lower DECIMAL(5,2),
  confidence_interval_upper DECIMAL(5,2),
  model_version VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  alert_type VARCHAR(100),
  severity VARCHAR(50),
  message TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_listening_sessions_user_id ON listening_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_listening_sessions_start_time ON listening_sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_weekly_listening_user_id ON weekly_listening(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_listening_week_start ON weekly_listening(week_start);
CREATE INDEX IF NOT EXISTS idx_risk_predictions_user_id ON risk_predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_predictions_prediction_date ON risk_predictions(prediction_date);
CREATE INDEX IF NOT EXISTS idx_hearing_age_user_id ON hearing_age(user_id);
CREATE INDEX IF NOT EXISTS idx_hearing_age_calculation_date ON hearing_age(calculation_date);
CREATE INDEX IF NOT EXISTS idx_forecasts_user_id ON risk_forecasts(user_id);
CREATE INDEX IF NOT EXISTS idx_forecasts_forecast_date ON risk_forecasts(forecast_date);
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_is_read ON alerts(is_read);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_spotify_tokens_updated_at BEFORE UPDATE ON spotify_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
