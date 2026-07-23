-- Migration 002: allow name-only person creates (F-01 / U-01)
-- Legacy pre-PSCL columns imdb_name_id and slug were NOT NULL. Admin create
-- treats them as optional; empty inserts must store NULL rather than 500.
--
-- Usage: psql "$DATABASE_URL" -f migrations/002_nullable_imdb_slug.sql

ALTER TABLE people
  ALTER COLUMN imdb_name_id DROP NOT NULL,
  ALTER COLUMN slug DROP NOT NULL;
