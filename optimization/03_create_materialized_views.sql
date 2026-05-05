-- ============================================================================
-- CIS 5500 Final Project — Optimization Step 3: MATERIALIZED VIEWS (CACHING)
-- ============================================================================
-- Purpose:
--   PostgreSQL materialized views (MVs) act as a caching layer at the database
--   level — expensive aggregations are computed once and stored on disk, then
--   subsequent queries read the pre-computed results instead of re-aggregating
--   over millions of rows on every request.
--
-- This addresses the Caching rubric category. We create 3 MVs:
--
--   1. mv_business_review_summary  — per-business review aggregates
--      Used by: Q4, Q5, Q6, Q8, Q11
--      Replaces: GROUP BY over 5.1M-row review table on every query
--      Size: ~145k rows (one per business)
--
--   2. mv_latest_housing — latest housing_trend per postal_code
--      Used by: Q4, Q8, Q11
--      Replaces: SELECT MAX(trend_date) ... FROM housing_trend GROUP BY ...
--      Size: ~4.7k rows (one per postal_code)
--
--   3. mv_oldest_housing — oldest housing_trend per postal_code
--      Used by: Q11
--      Replaces: SELECT MIN(trend_date) ... FROM housing_trend GROUP BY ...
--      Size: ~4.7k rows
--
-- Total MV storage: ~70 MB (negligible vs 4 GB review table).
--
-- Refresh strategy:
--   These MVs need refreshing when underlying data changes:
--     REFRESH MATERIALIZED VIEW mv_business_review_summary;
--     REFRESH MATERIALIZED VIEW mv_latest_housing;
--     REFRESH MATERIALIZED VIEW mv_oldest_housing;
--   For our use case (Yelp/Zillow data is static historical), refresh is
--   only needed if the dataset is reloaded.
--
-- Application-level caching (NOT implemented, documented in report):
--   We considered Redis-based caching of /city_business_stats, /cities, and
--   /zip_codes endpoints (which return mostly-static results), but determined
--   that:
--     (a) The CIS 5500 milestone scope does not require it.
--     (b) Materialized views already handle the heavy queries.
--     (c) Adding Redis would introduce deployment complexity for marginal gain.
--   Listed in 'Future Work' section of the report.
-- ============================================================================

\timing on
SET statement_timeout = 0;
SET client_min_messages = WARNING;

\echo
\echo '################################################################'
\echo '# CREATING MATERIALIZED VIEWS (CACHING LAYER)                  #'
\echo '################################################################'
\echo


-- ----------------------------------------------------------------------------
-- MV 1: mv_business_review_summary
--   Pre-aggregates COUNT/AVG/SUM of review fields per business_id.
--   This is the BIGGEST optimization win — replaces the 5.1M-row scan +
--   group-by-business operation that dominates Q4/Q5/Q6 runtime.
--
-- Cardinality: ~145k rows (one per business).
-- Estimated build time: ~25-40 seconds (one-time cost).
-- ----------------------------------------------------------------------------
\echo '--- creating mv_business_review_summary ---'
DROP MATERIALIZED VIEW IF EXISTS mv_business_review_summary CASCADE;
CREATE MATERIALIZED VIEW mv_business_review_summary AS
SELECT business_id,
       COUNT(*)         AS review_count,
       AVG(stars)       AS avg_review_stars,
       SUM(useful)      AS total_useful,
       SUM(funny)       AS total_funny,
       SUM(cool)        AS total_cool
FROM review
GROUP BY business_id;

CREATE UNIQUE INDEX idx_mv_brs_business_id
  ON mv_business_review_summary (business_id);

CREATE INDEX idx_mv_brs_review_count
  ON mv_business_review_summary (review_count);
\echo


-- ----------------------------------------------------------------------------
-- MV 2: mv_latest_housing
--   For each postal_code, the most recent housing_trend record.
--   Q4/Q8/Q11 all need "latest housing price per zip" — without this MV,
--   each query re-runs the same INNER JOIN + MAX(trend_date) subquery.
--
-- Uses DISTINCT ON to pick the row with max trend_date per postal_code
-- (PostgreSQL-specific, more efficient than equivalent MAX() + JOIN).
-- ----------------------------------------------------------------------------
\echo '--- creating mv_latest_housing ---'
DROP MATERIALIZED VIEW IF EXISTS mv_latest_housing CASCADE;
CREATE MATERIALIZED VIEW mv_latest_housing AS
SELECT DISTINCT ON (postal_code)
       postal_code,
       trend_date,
       zhvi_value
FROM housing_trend
ORDER BY postal_code, trend_date DESC;

CREATE UNIQUE INDEX idx_mv_latest_postal_code
  ON mv_latest_housing (postal_code);
\echo


-- ----------------------------------------------------------------------------
-- MV 3: mv_oldest_housing
--   Symmetric to mv_latest_housing — earliest housing_trend per zip.
--   Q11 needs both latest and oldest to compute zhvi_growth.
-- ----------------------------------------------------------------------------
\echo '--- creating mv_oldest_housing ---'
DROP MATERIALIZED VIEW IF EXISTS mv_oldest_housing CASCADE;
CREATE MATERIALIZED VIEW mv_oldest_housing AS
SELECT DISTINCT ON (postal_code)
       postal_code,
       trend_date,
       zhvi_value
FROM housing_trend
ORDER BY postal_code, trend_date ASC;

CREATE UNIQUE INDEX idx_mv_oldest_postal_code
  ON mv_oldest_housing (postal_code);
\echo


-- ----------------------------------------------------------------------------
-- ANALYZE the new views so the planner can pick them.
-- ----------------------------------------------------------------------------
\echo '--- ANALYZE materialized views ---'
ANALYZE mv_business_review_summary;
ANALYZE mv_latest_housing;
ANALYZE mv_oldest_housing;
\echo


-- ----------------------------------------------------------------------------
-- Sanity check: row counts and disk sizes.
-- ----------------------------------------------------------------------------
\echo '--- materialized view sanity check ---'
SELECT  schemaname,
        matviewname,
        pg_size_pretty(pg_relation_size((schemaname||'.'||matviewname)::regclass)) AS size,
        ispopulated
FROM pg_matviews
WHERE schemaname = 'public'
ORDER BY matviewname;

\echo
\echo '--- row counts ---'
SELECT 'mv_business_review_summary' AS mv, COUNT(*) FROM mv_business_review_summary
UNION ALL SELECT 'mv_latest_housing',          COUNT(*) FROM mv_latest_housing
UNION ALL SELECT 'mv_oldest_housing',          COUNT(*) FROM mv_oldest_housing;
\echo


\echo '################################################################'
\echo '# MATERIALIZED VIEWS CREATED                                   #'
\echo '#   Next: run optimization/04_optimized_queries.sql to test    #'
\echo '#   the rewritten queries against the MVs.                     #'
\echo '################################################################'
