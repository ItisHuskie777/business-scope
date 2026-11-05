-- ============================================================================
-- Optimization step 6: indexes for the lookup and listing endpoints
-- ============================================================================
-- The Business Explorer page filters and pages the business table directly.
-- Without these, every one of its requests is a sequential scan of ~145k rows
-- (plus a sort for the listing).
--
--   idx_business_state_city     /businesses?state=&city=   and  /cities?state=
--   idx_business_city           /zip_codes?city=           and  /businesses?city=
--   idx_business_name_id        /businesses listing: rows are returned in
--                               (name, business_id) order, so a page is read
--                               straight from the index instead of sorting
--                               the table for every request
--
-- The table is a static snapshot, so the extra indexes cost nothing at write time.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_business_state_city
  ON business (state, city);

CREATE INDEX IF NOT EXISTS idx_business_city
  ON business (city);

CREATE INDEX IF NOT EXISTS idx_business_name_id
  ON business (name, business_id);

ANALYZE business;
