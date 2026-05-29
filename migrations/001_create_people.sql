-- Migration 001: extend existing people table for Preference Signal Capture Loop
-- Run once against the Postgres.com instance before first deploy.
-- DATABASE_URL must point to the Postgres.com database.
--
-- Existing columns (unchanged): id, imdb_name_id, slug, name, created_at
-- Reused by PSCL: id (UUID PK), name (display name)
-- Added by PSCL: wikipedia_* fields, aggregate counters, metadata, last_updated
--
-- Usage: psql $DATABASE_URL -f migrations/001_create_people.sql

-- Wikipedia identity and enrichment (nullable until populated by signal upsert)
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS wikipedia_article_title TEXT,
  ADD COLUMN IF NOT EXISTS wikipedia_page_url TEXT,
  ADD COLUMN IF NOT EXISTS wikipedia_image_url TEXT;

-- Anonymized preference aggregates
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS shown_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS positive_count INT NOT NULL DEFAULT 0;

-- Extension hook and write-path timestamp (distinct from created_at)
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ;

UPDATE people
SET last_updated = created_at
WHERE last_updated IS NULL;

ALTER TABLE people
  ALTER COLUMN last_updated SET DEFAULT now(),
  ALTER COLUMN last_updated SET NOT NULL;

-- Partial unique index: enforce uniqueness only on non-null titles.
-- Allows multiple rows with NULL wikipedia_article_title (if title is unknown).
CREATE UNIQUE INDEX IF NOT EXISTS people_wikipedia_title_idx
  ON people (wikipedia_article_title)
  WHERE wikipedia_article_title IS NOT NULL;
