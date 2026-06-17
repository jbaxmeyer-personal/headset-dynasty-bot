-- CFB27 Multi-Server Migration (v2 — scheme support)
-- Run all statements in the Supabase SQL Editor in order.
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ================================================================
-- v1 tables (skip if already run)
-- ================================================================

CREATE TABLE IF NOT EXISTS schools (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  conference  TEXT,
  stars       NUMERIC(2,1)
);

CREATE TABLE IF NOT EXISTS leagues (
  id                      SERIAL PRIMARY KEY,
  guild_id                TEXT NOT NULL UNIQUE,
  name                    TEXT,
  general_channel_id      TEXT,
  rules_channel_id        TEXT,
  team_list_channel_id    TEXT,
  coach_role_id           TEXT,
  allowed_roles           TEXT DEFAULT 'HC',
  allowed_conferences     TEXT,
  min_stars               NUMERIC(2,1) DEFAULT 0.0,
  max_stars               NUMERIC(2,1) DEFAULT 5.0
);

CREATE TABLE IF NOT EXISTS league_teams (
  id            SERIAL PRIMARY KEY,
  league_id     INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  school_id     INTEGER NOT NULL REFERENCES schools(id),
  taken_by      TEXT NOT NULL,
  taken_by_name TEXT,
  role          TEXT NOT NULL DEFAULT 'HC',
  channel_id    TEXT,
  UNIQUE(league_id, school_id)
);

-- One-time: populate schools from old teams table (skip if already done)
INSERT INTO schools (name, conference, stars)
SELECT name, conference, stars FROM teams
ON CONFLICT DO NOTHING;

-- ================================================================
-- v2 additions — scheme support
-- ================================================================

-- Add scheme columns to schools
ALTER TABLE schools ADD COLUMN IF NOT EXISTS offense_scheme TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS defense_scheme TEXT;

-- Add scheme filter toggle and offer count to leagues
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS scheme_filter BOOLEAN DEFAULT FALSE;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS offer_count INTEGER DEFAULT 5;

-- Add preferred scheme columns to league_teams
ALTER TABLE league_teams ADD COLUMN IF NOT EXISTS preferred_offense_scheme TEXT;
ALTER TABLE league_teams ADD COLUMN IF NOT EXISTS preferred_defense_scheme TEXT;

-- ================================================================
-- Reference: CFB27 offensive schemes
-- ================================================================
-- Option, Spread, Veer and Shoot, Air Raid,
-- Pro Style, Power Spread, Run and Shoot, Pistol, Multiple

-- ================================================================
-- Reference: CFB27 defensive schemes
-- ================================================================
-- 3-2-6, 3-3-5, 3-3-5 Tite, 3-4,
-- 3-4 Multiple, 4-2-5, 4-3, 4-3 Multiple, Multiple

-- After running this migration, populate offense_scheme and defense_scheme
-- on each row in the schools table with the correct CFB27 values.
