-- ============================================================================
-- CIS 5500 Final Project — Optimization Step 2: CREATE INDEXES
-- ============================================================================
-- Purpose:
--   Add B-tree indexes to attack the bottlenecks identified in baseline runs:
--     * review.business_id has NO index → 5 complex queries do Parallel Seq
--       Scan over 5.1M rows on every join (~19-25 s each).
--     * business.postal_code has NO index → joins to zip_region/housing_trend
--       fall back to hash joins requiring full business scan.
--     * housing_trend.trend_date has NO index → Q11 does 2 full scans to find
--       MIN(trend_date) and MAX(trend_date).
--
-- Indexes EVALUATED but NOT created (documented for the report):
--   * idx_review_stars: Q4 HAVING AVG(stars)>4.0 happens AFTER GROUP BY,
--                       a column index can't help post-aggregation filters.
--   * idx_zip_region_city: zip_region has only 4683 rows (~150 pages),
--                          seq scan finishes in ~8 ms — index is overhead.
--   * idx_business_business_id: already covered by business_pkey.
--
-- Expected effect (predicted from EXPLAIN plans):
--   * Q4  48.9s → ~10-20s (after index alone, before MV)
--   * Q5  49.5s → ~10-20s
--   * Q6  30.2s → ~ 8-15s
--   * Q8  52.4s → ~10-20s
--   * Q11 46.0s → ~10-15s (also benefits from idx_housing_trend_trend_date)
--   Further drop to <2 s comes from materialized views (step 03).
--
-- How to run (single line, from project root):
--   psql "host=cis5500-project-mirror.cdntwwouizxi.us-east-1.rds.amazonaws.com port=5432 dbname=postgres user=postgres sslmode=require" -f optimization/02_create_indexes.sql
--
-- Notes:
--   * Building idx_review_business_id on 5.1M rows takes ~30-60 seconds.
--   * IF NOT EXISTS makes the script safe to re-run.
--   * After this script, re-run 01_baseline_complex_queries.sql to capture
--     "after-index" timings for the rubric's Indexing section.
-- ============================================================================

\timing on
SET statement_timeout = 0;
SET client_min_messages = WARNING;

\echo
\echo '################################################################'
\echo '# CREATING INDEXES                                              #'
\echo '################################################################'
\echo


-- ----------------------------------------------------------------------------
-- INDEX 1: review.business_id  ★ THE primary optimization
--   Used by: Q4, Q5, Q6, Q8, Q11 (every complex query joins review.business_id)
--   Why:    converts Parallel Hash Join over a 5.1M-row Seq Scan into an
--           Index Scan / Nested Loop. Critical because review is 4 GB and
--           dominates ~40% of every complex query's runtime.
-- ----------------------------------------------------------------------------
\echo '--- creating idx_review_business_id on review(business_id) ---'
CREATE INDEX IF NOT EXISTS idx_review_business_id
  ON review (business_id);
\echo


-- ----------------------------------------------------------------------------
-- INDEX 2: business.postal_code
--   Used by: Q4, Q5, Q8, Q11 (any join business ↔ zip_region / housing_trend)
--   Why:    business has 144,789 rows. Seq scan is fast (~20 ms) but the
--           index lets the planner pick nested-loop joins to the small
--           zip_region (4.6k rows) and to housing_trend (using its PK).
-- ----------------------------------------------------------------------------
\echo '--- creating idx_business_postal_code on business(postal_code) ---'
CREATE INDEX IF NOT EXISTS idx_business_postal_code
  ON business (postal_code);
\echo


-- ----------------------------------------------------------------------------
-- INDEX 3: housing_trend.trend_date  ★ Q11-specific optimization
--   Used by: Q11 (and the 'find latest housing' subquery in Q4/Q8)
--   Why:    Q11's plan shows 2 InitPlan subqueries each scanning 1.1M rows
--           to compute MIN(trend_date) and MAX(trend_date). With this index,
--           PG can do an Index Scan returning just the first/last row.
--   Note:   housing_trend already has PK (postal_code, trend_date), but the
--           leading column is postal_code, so the PK can't be used for
--           date-only aggregations.
-- ----------------------------------------------------------------------------
\echo '--- creating idx_housing_trend_trend_date on housing_trend(trend_date) ---'
CREATE INDEX IF NOT EXISTS idx_housing_trend_trend_date
  ON housing_trend (trend_date);
\echo


-- ----------------------------------------------------------------------------
-- ANALYZE the tables so the planner refreshes statistics and picks new indexes.
-- Without ANALYZE, the planner may still pick the old plan due to stale
-- row-count estimates.
-- ----------------------------------------------------------------------------
\echo '--- ANALYZE business, review, housing_trend ---'
ANALYZE business;
ANALYZE review;
ANALYZE housing_trend;
\echo


-- ----------------------------------------------------------------------------
-- Verify the indexes are present and report their on-disk size.
-- ----------------------------------------------------------------------------
\echo '--- index sanity check ---'
SELECT  indexrelname                                      AS index_name,
        relname                                           AS table_name,
        pg_size_pretty(pg_relation_size(indexrelid))      AS size,
        idx_scan                                          AS times_used
FROM    pg_stat_user_indexes
WHERE   relname IN ('review', 'business', 'housing_trend', 'zip_region')
ORDER BY relname, indexrelname;
\echo


\echo '################################################################'
\echo '# INDEXES CREATED                                              #'
\echo '#   Next: re-run 01_baseline_complex_queries.sql in DataGrip   #'
\echo '#   capture "after-index" timings.                             #'
\echo '#   Then run optimization/03_create_materialized_views.sql.    #'
\echo '################################################################'
