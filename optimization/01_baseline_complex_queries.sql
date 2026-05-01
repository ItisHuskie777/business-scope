-- ============================================================================
-- CIS 5500 Final Project — Optimization BASELINE (pre-optimization timings)
-- ============================================================================
-- Purpose:
--   Run EXPLAIN (ANALYZE, BUFFERS) on all 4 complex queries (Q4, Q5, Q6, Q11)
--   so we can record the "before optimization" execution times for the
--   final-report Performance Evaluation table and demo narration.
--
-- How to run (from the project root):
--   psql "host=cis5500-project.civkthoibwwa.us-east-1.rds.amazonaws.com \
--         port=5432 dbname=postgres user=postgres sslmode=require" \
--        -f optimization/01_baseline_complex_queries.sql \
--        > optimization/baseline_run1.txt 2>&1
--
--   Run the script 3 times (run1 / run2 / run3). The first run is "cold
--   cache" (pessimistic). Use the median of run2 and run3 for the report,
--   and keep run1 to discuss caching effects.
--
-- Notes:
--   * Use the postgres master account (not guest) — guest is read-only and
--     can't run some EXPLAIN options on certain plans.
--   * statement_timeout is disabled in this session so true baselines are
--     not truncated. This does NOT change server-side defaults.
--   * Default parameters match the defaults in server/routes.js.
-- ============================================================================

\timing on
SET statement_timeout = 0;
SET client_min_messages = WARNING;

\echo
\echo '################################################################'
\echo '# BASELINE RUN — pre-optimization complex query timings        #'
\echo '################################################################'
\echo

-- Sanity check: verify table sizes so we know we are pointed at the right DB.
\echo '--- table row counts (sanity check) ---'
SELECT 'zip_region'    AS table_name, COUNT(*) AS rows FROM zip_region
UNION ALL SELECT 'business',           COUNT(*) FROM business
UNION ALL SELECT 'review',             COUNT(*) FROM review
UNION ALL SELECT 'housing_trend',      COUNT(*) FROM housing_trend;
\echo


-- ----------------------------------------------------------------------------
-- Q4: high_rated_with_housing
--     Defaults: min_reviews = 50, min_rating = 4.0
--     Joins business + review + (housing_trend latest-per-zip subquery)
-- ----------------------------------------------------------------------------
\echo '================================================================'
\echo 'Q4 — high_rated_with_housing  (min_reviews=50, min_rating=4.0)'
\echo '================================================================'

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT b.business_id, b.name, b.postal_code,
       COUNT(r.review_id)  AS review_count,
       AVG(r.stars)        AS avg_review_stars,
       h.zhvi_value        AS latest_zhvi
FROM business b
JOIN review r ON b.business_id = r.business_id
LEFT JOIN (
    SELECT ht.postal_code, ht.zhvi_value
    FROM housing_trend ht
    INNER JOIN (
        SELECT postal_code, MAX(trend_date) AS latest_date
        FROM housing_trend
        GROUP BY postal_code
    ) latest ON ht.postal_code = latest.postal_code
           AND ht.trend_date  = latest.latest_date
) h ON b.postal_code = h.postal_code
GROUP BY b.business_id, b.name, b.postal_code, h.zhvi_value
HAVING COUNT(r.review_id) >= 50
   AND AVG(r.stars) > 4.0
ORDER BY avg_review_stars DESC;
\echo


-- ----------------------------------------------------------------------------
-- Q5: business_review_stats  (CTE + RANK per city version, see routes.js)
--     Defaults: min_reviews = 50, top_n = 5, limit = 50, offset = 0
--     Joins business + review + zip_region; window function over CTE
-- ----------------------------------------------------------------------------
\echo '================================================================'
\echo 'Q5 — business_review_stats  (min_reviews=50, top_n=5, limit=50)'
\echo '================================================================'

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH review_agg AS (
  SELECT b.business_id,
         b.name,
         b.postal_code,
         z.city,
         COUNT(r.review_id) AS total_reviews,
         AVG(r.stars)       AS avg_review_rating,
         SUM(r.useful)      AS total_useful,
         SUM(r.funny)       AS total_funny,
         SUM(r.cool)        AS total_cool
  FROM business b
  JOIN review r     ON b.business_id = r.business_id
  JOIN zip_region z ON b.postal_code = z.postal_code
  GROUP BY b.business_id, b.name, b.postal_code, z.city
  HAVING COUNT(r.review_id) >= 50
),
ranked AS (
  SELECT ra.*,
         RANK() OVER (PARTITION BY city ORDER BY total_reviews DESC) AS city_review_rank
  FROM review_agg ra
)
SELECT business_id, name, postal_code, city,
       total_reviews, avg_review_rating,
       total_useful, total_funny, total_cool,
       city_review_rank
FROM ranked
WHERE city_review_rank <= 5
ORDER BY city, city_review_rank, total_reviews DESC
LIMIT 50 OFFSET 0;
\echo


-- ----------------------------------------------------------------------------
-- Q6: top_business_per_zip
--     Defaults: limit = 100
--     Window function (RANK) over business LEFT JOIN review
-- ----------------------------------------------------------------------------
\echo '================================================================'
\echo 'Q6 — top_business_per_zip  (limit=100)'
\echo '================================================================'

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT postal_code, name, review_count
FROM (
    SELECT b.postal_code,
           b.name,
           COUNT(r.review_id) AS review_count,
           RANK() OVER (PARTITION BY b.postal_code ORDER BY COUNT(r.review_id) DESC) AS rnk
    FROM business b
    LEFT JOIN review r ON b.business_id = r.business_id
    GROUP BY b.postal_code, b.business_id, b.name
) t
WHERE rnk = 1
ORDER BY review_count DESC
LIMIT 100;
\echo


-- ----------------------------------------------------------------------------
-- Q11: opportunity_score
--      Defaults: min_businesses = 10
--      4-table join: business + zip_region + review + 2 housing subqueries
-- ----------------------------------------------------------------------------
\echo '================================================================'
\echo 'Q11 — opportunity_score  (min_businesses=10)'
\echo '================================================================'

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT b.postal_code, z.city,
       COUNT(DISTINCT b.business_id)          AS business_count,
       ROUND(AVG(b.stars)::numeric, 2)        AS avg_business_stars,
       ROUND(AVG(r.stars)::numeric, 2)        AS avg_review_stars,
       MAX(h_latest.zhvi_value)               AS latest_zhvi,
       ROUND((MAX(h_latest.zhvi_value) - MIN(h_oldest.zhvi_value))::numeric, 2) AS zhvi_growth
FROM business b
JOIN zip_region z ON b.postal_code = z.postal_code
JOIN review r     ON b.business_id = r.business_id
JOIN (
    SELECT postal_code, zhvi_value
    FROM housing_trend
    WHERE trend_date = (SELECT MAX(trend_date) FROM housing_trend)
) h_latest ON b.postal_code = h_latest.postal_code
JOIN (
    SELECT postal_code, zhvi_value
    FROM housing_trend
    WHERE trend_date = (SELECT MIN(trend_date) FROM housing_trend)
) h_oldest ON b.postal_code = h_oldest.postal_code
GROUP BY b.postal_code, z.city
HAVING COUNT(DISTINCT b.business_id) >= 10
ORDER BY avg_review_stars DESC;
\echo


\echo '################################################################'
\echo '# BASELINE RUN COMPLETE                                        #'
\echo '#   Look for "Execution Time: ... ms" at the end of each plan. #'
\echo '#   Record those numbers in optimization_baseline.md.          #'
\echo '################################################################'
