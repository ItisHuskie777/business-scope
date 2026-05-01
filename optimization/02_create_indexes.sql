-- ============================================================================
-- CIS 5500 Final Project — Optimization step 2: CREATE INDEXES
-- ============================================================================
-- Purpose:
--   Add B-tree indexes to attack the bottlenecks identified in baseline_run1:
--     * review.business_id has NO index → all 4 complex queries do a parallel
--       seq scan over 5M rows on every join (~22–25 s each).
--     * business.postal_code has NO index → joins to zip_region and
--       housing_trend fall back to hash joins.
--     * housing_trend already has a PK on (postal_code, trend_date), so we
--       reuse that — no new index needed there.
--
-- Expected effect (predicted from EXPLAIN plans):
--   * Q4  49.2s → ~ 1–3s
--   * Q5  49.5s → ~ 1–3s
--   * Q6  30.5s → ~ 1–2s
--   * Q11 41.9s → ~ 1–3s
--
-- How to run (single line, from project root):
--   psql "host=cis5500-project.civkthoibwwa.us-east-1.rds.amazonaws.com port=5432 dbname=postgres user=postgres sslmode=require" -f optimization/02_create_indexes.sql > optimization/index_creation.log 2>&1
--
-- Notes:
--   * Building idx_review_business_id on 5M rows takes ~30–60 seconds.
--   * IF NOT EXISTS makes the script safe to re-run.
--   * After this script finishes, re-run optimization/01_baseline_complex_queries.sql
--     and save to post_optimization_run1.txt to capture post-optimization timings.
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
-- INDEX 1: review.business_id  — THE primary optimization
--   Used by: Q4, Q5, Q6, Q11 (every complex query joins review on business_id)
--   Why:    converts Parallel Hash Join over a 5M-row Seq Scan into an Index
--           Scan / Nested Loop. Also lets the planner avoid the 150–185 MB
--           external-merge sort that follows the join.
-- ----------------------------------------------------------------------------
\echo '--- creating idx_review_business_id on review(business_id) ---'
CREATE INDEX IF NOT EXISTS idx_review_business_id
  ON review (business_id);
\echo


-- ----------------------------------------------------------------------------
-- INDEX 2: business.postal_code
--   Used by: Q4, Q5, Q8, Q9, Q11 (any join business ↔ zip_region / housing)
--   Why:    business has 144k rows; the seq scan is fast on its own (~180 ms),
--           but the index lets the planner pick nested-loop joins to the
--           tiny zip_region (4.6k rows) and to housing_trend (using its PK).
-- ----------------------------------------------------------------------------
\echo '--- creating idx_business_postal_code on business(postal_code) ---'
CREATE INDEX IF NOT EXISTS idx_business_postal_code
  ON business (postal_code);
\echo


-- ----------------------------------------------------------------------------
-- INDEX 3: review.stars  (optional, light)
--   Used by: Q4 (HAVING AVG(r.stars) > 4.0), and any future filter/sort by stars.
--   Why:    Q4 and Q5 aggregate r.stars per business; an index on stars alone
--           does NOT help the GROUP BY (it groups by business_id), but it does
--           help any future per-business "show top-rated reviews" query.
--   This is a safe, small index — keep it for variety in the report's
--   "indexing tried" discussion.
-- ----------------------------------------------------------------------------
\echo '--- creating idx_review_stars on review(stars) ---'
CREATE INDEX IF NOT EXISTS idx_review_stars
  ON review (stars);
\echo


-- ----------------------------------------------------------------------------
-- ANALYZE the tables so the planner refreshes its statistics and starts
-- choosing the new indexes.  Without ANALYZE the planner may still pick the
-- old plan because its row estimates are stale.
-- ----------------------------------------------------------------------------
\echo '--- ANALYZE business, review, housing_trend ---'
ANALYZE business;
ANALYZE review;
ANALYZE housing_trend;
\echo


-- ----------------------------------------------------------------------------
-- Verify the indexes are present and report their disk size.
-- ----------------------------------------------------------------------------
\echo '--- index sanity check ---'
SELECT  indexrelname                       AS index_name,
        relname                            AS table_name,
        pg_size_pretty(pg_relation_size(indexrelid)) AS size,
        idx_scan                           AS times_used
FROM    pg_stat_user_indexes
JOIN    pg_class ON pg_class.oid = indexrelid
WHERE   relname IN ('review', 'business', 'housing_trend', 'zip_region')
ORDER BY relname, indexrelname;
\echo


\echo '################################################################'
\echo '# INDEXES CREATED                                              #'
\echo '#   Next: re-run optimization/01_baseline_complex_queries.sql  #'
\echo '#   and save to post_optimization_run1.txt for the comparison. #'
\echo '################################################################'
