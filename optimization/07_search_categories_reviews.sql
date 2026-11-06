-- ============================================================================
-- Step 7: indexes and views for search, categories and the review feed
-- ============================================================================
-- Run after 06_lookup_indexes.sql. Needs the pg_trgm extension, which ships
-- with PostgreSQL (contrib) and is allowed on AWS RDS.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ----------------------------------------------------------------------------
-- Search (/search)
--
-- Two GIN indexes, one per kind of match the endpoint combines:
--   * trigram index on name: substring matches (ILIKE '%starb%', for typing
--     ahead) and fuzzy matches (word similarity, for typos);
--   * full-text index on name + categories: word matches with stemming, so
--     "bakery" finds "Bakeries". The endpoint uses this exact expression,
--     otherwise the planner cannot use the index.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_business_name_trgm
  ON business USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_business_search_fts
  ON business USING gin (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(categories, '')));


-- ----------------------------------------------------------------------------
-- Categories
--
-- business.categories is a comma-separated string ("Restaurants, Pizza"),
-- which cannot be indexed per category. mv_business_category normalizes it to
-- one row per (business, category).
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_category_summary;
DROP MATERIALIZED VIEW IF EXISTS mv_business_category;

CREATE MATERIALIZED VIEW mv_business_category AS
SELECT DISTINCT b.business_id, btrim(c) AS category
FROM business b
CROSS JOIN LATERAL unnest(string_to_array(b.categories, ',')) AS c
WHERE btrim(c) <> '';

CREATE UNIQUE INDEX idx_mv_business_category_pk
  ON mv_business_category (business_id, category);

-- /businesses?category= and the per-city category counts look up by category.
CREATE INDEX idx_mv_business_category_category
  ON mv_business_category (category, business_id);

-- Dataset-wide category statistics for /categories without a city filter.
CREATE MATERIALIZED VIEW mv_category_summary AS
SELECT bc.category,
       COUNT(*)                                      AS business_count,
       AVG(b.stars)                                  AS avg_stars,
       COALESCE(SUM(brs.review_count), 0)::bigint    AS total_reviews
FROM mv_business_category bc
JOIN business b ON b.business_id = bc.business_id
LEFT JOIN mv_business_review_summary brs ON brs.business_id = bc.business_id
GROUP BY bc.category;

CREATE UNIQUE INDEX idx_mv_category_summary_category
  ON mv_category_summary (category);

CREATE INDEX idx_mv_category_summary_count
  ON mv_category_summary (business_count DESC, category);


-- ----------------------------------------------------------------------------
-- Review feed (/business/:id/reviews) and rating trend (/business/:id/rating_trend)
--
-- The feed is newest first and paged with a cursor on (date, review_id). This
-- index is in that order, so any page, however deep, is one index range scan.
-- NULL dates sort last through COALESCE; the endpoint uses the same expression.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_review_business_date
  ON review (business_id, (COALESCE(review_date, '-infinity'::timestamp)) DESC, review_id DESC);


ANALYZE business;
ANALYZE review;
ANALYZE mv_business_category;
ANALYZE mv_category_summary;
