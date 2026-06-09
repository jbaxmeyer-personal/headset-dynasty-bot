-- CFB27 Multi-Server Migration
-- Run these statements in the Supabase SQL Editor in order.
-- The old tables (teams, results, records, news_feed, meta) are left intact
-- so commented-out features can be re-enabled later.

-- Step 1: Reference table for all CFB schools (shared across all leagues)
CREATE TABLE IF NOT EXISTS schools (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  conference  TEXT,
  stars       NUMERIC(2,1)   -- 0.0-5.0
);

-- Step 2: One row per Discord server
CREATE TABLE IF NOT EXISTS leagues (
  id                      SERIAL PRIMARY KEY,
  guild_id                TEXT NOT NULL UNIQUE,
  name                    TEXT,
  general_channel_id      TEXT,
  rules_channel_id        TEXT,
  team_list_channel_id    TEXT,
  coach_role_id           TEXT,
  allowed_roles           TEXT DEFAULT 'HC',    -- 'HC' | 'OC,DC' | 'HC,OC,DC'
  allowed_conferences     TEXT,                 -- NULL = all; comma-separated e.g. 'SEC,Big Ten'
  min_stars               NUMERIC(2,1) DEFAULT 0.0,
  max_stars               NUMERIC(2,1) DEFAULT 5.0
);

-- Step 3: Schools available per league + who has claimed them
-- Only claimed schools have rows here; available schools are queried live from `schools`.
CREATE TABLE IF NOT EXISTS league_teams (
  id            SERIAL PRIMARY KEY,
  league_id     INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  school_id     INTEGER NOT NULL REFERENCES schools(id),
  taken_by      TEXT NOT NULL,
  taken_by_name TEXT,
  role          TEXT NOT NULL DEFAULT 'HC',    -- 'HC', 'OC', or 'DC'
  channel_id    TEXT,
  UNIQUE(league_id, school_id)                -- one coach per school per league
);

-- Step 4: Populate schools from the existing teams table (one-time migration)
INSERT INTO schools (name, conference, stars)
SELECT name, conference, stars
FROM teams
ON CONFLICT DO NOTHING;
