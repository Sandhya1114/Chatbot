-- ============================================================
-- supabase/scraped_data_migration.sql
--
-- Scraped Web Data Storage
--
-- Run in: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================


-- ============================================================
-- EXTENSION
-- Needed for gen_random_uuid()
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- SHARED updated_at FUNCTION
-- Reuse your existing trigger helper if it does not exist yet.
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- TABLE: scraped_data
-- Stores structured web-scraped product/page data
--
-- Dedup rule:
--   source_url is UNIQUE
--   same URL = update existing row
-- ============================================================
CREATE TABLE IF NOT EXISTS scraped_data (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  price       TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  source_url  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT scraped_data_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT scraped_data_source_url_not_blank CHECK (btrim(source_url) <> '')
);


-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================
DROP TRIGGER IF EXISTS set_scraped_data_updated_at ON scraped_data;
CREATE TRIGGER set_scraped_data_updated_at
  BEFORE UPDATE ON scraped_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- INDEXES
-- source_url already gets a unique index automatically.
-- Additional indexes below help read-heavy/admin queries.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_scraped_data_created_at
  ON scraped_data (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scraped_data_updated_at
  ON scraped_data (updated_at DESC);


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Matches your current setup style.
-- IMPORTANT: tighten this in production if needed.
-- ============================================================
ALTER TABLE scraped_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for anon" ON scraped_data;
CREATE POLICY "Allow all for anon" ON scraped_data
  FOR ALL TO anon USING (true) WITH CHECK (true);


-- ============================================================
-- VERIFY
-- ============================================================
SELECT 'scraped_data table ready' AS info;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'scraped_data';

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'scraped_data';
