-- ============================================================================
-- CIS 5500 Final Project — Optimization Step 4: REWRITTEN COMPLEX QUERIES
-- ============================================================================
-- Purpose:
--   Each of the 5 complex queries has been rewritten to use:
--     (a) the indexes from step 02,
--     (b) the materialized views from step 03, and
--     (c) structural changes (push-down filters, CTE simplification, etc.).
--
-- Run this file in DataGrip to capture FINAL post-optimization timings for
-- the rubric's Timings table. Each query has PLAIN + EXPLAIN ANALYZE versions,
-- same convention as 01_baseline_complex_queries.sql.
--
-- IMPORTANT: This file assumes 02_create_indexes.sql AND
--            03_create_materialized_views.sql have already been run.
-- ============================================================================


-- ###########################################################################
-- # Q4 OPTIMIZED — high_rated_with_housing                                  #
-- # Original baseline: 48.9 s   |   Target: < 2 s                           #
-- # Optimization techniques used:                                           #
-- #   1. Indexing: idx_review_business_id (no longer scanned via base table)#
-- #   2. Caching: mv_business_review_summary replaces GROUP BY review       #
-- #              mv_latest_housing replaces MAX(trend_date) subquery        #
-- #   3. Restructuring: HAVING → WHERE (pre-filter before final select)     #
-- ###########################################################################

-- ---- Q4 OPTIMIZED PLAIN ---------------------------------------------------
SELECT b.business_id, b.name, b.postal_code,
       brs.review_count,
       brs.avg_review_stars,
       lh.zhvi_value AS latest_zhvi
FROM business b
JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
LEFT JOIN mv_latest_housing lh       ON b.postal_code = lh.postal_code
WHERE brs.review_count >= 50
  AND brs.avg_review_stars > 4.0
ORDER BY brs.avg_review_stars DESC;

-- ---- Q4 OPTIMIZED EXPLAIN -------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT b.business_id, b.name, b.postal_code,
       brs.review_count,
       brs.avg_review_stars,
       lh.zhvi_value AS latest_zhvi
FROM business b
JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
LEFT JOIN mv_latest_housing lh       ON b.postal_code = lh.postal_code
WHERE brs.review_count >= 50
  AND brs.avg_review_stars > 4.0
ORDER BY brs.avg_review_stars DESC;


-- ###########################################################################
-- # Q5 OPTIMIZED — business_review_stats (CTE + RANK per city)              #
-- # Original baseline: 49.5 s   |   Target: < 2 s                           #
-- # Optimization techniques used:                                           #
-- #   1. Indexing: idx_business_postal_code (faster zip_region join)        #
-- #   2. Caching: mv_business_review_summary replaces CTE first stage       #
-- #              (the GROUP BY business_id over 5.1M reviews)               #
-- #   3. Restructuring: WHERE on MV column instead of HAVING after agg      #
-- ###########################################################################

-- ---- Q5 OPTIMIZED PLAIN ---------------------------------------------------
WITH review_agg AS (
  SELECT b.business_id,
         b.name,
         b.postal_code,
         z.city,
         brs.review_count       AS total_reviews,
         brs.avg_review_stars   AS avg_review_rating,
         brs.total_useful,
         brs.total_funny,
         brs.total_cool
  FROM business b
  JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
  JOIN zip_region z                   ON b.postal_code = z.postal_code
  WHERE brs.review_count >= 50
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

-- ---- Q5 OPTIMIZED EXPLAIN -------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
WITH review_agg AS (
  SELECT b.business_id,
         b.name,
         b.postal_code,
         z.city,
         brs.review_count       AS total_reviews,
         brs.avg_review_stars   AS avg_review_rating,
         brs.total_useful,
         brs.total_funny,
         brs.total_cool
  FROM business b
  JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
  JOIN zip_region z                   ON b.postal_code = z.postal_code
  WHERE brs.review_count >= 50
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


-- ###########################################################################
-- # Q6 OPTIMIZED — top_business_per_zip                                     #
-- # Original baseline: 30.2 s   |   Target: < 2 s                           #
-- # Optimization techniques used:                                           #
-- #   1. Indexing: idx_business_postal_code (already supports RANK PARTITION)
-- #   2. Caching: mv_business_review_summary supplies review_count directly #
-- #   3. Restructuring: LEFT JOIN MV replaces LEFT JOIN review + GROUP BY,  #
-- #                     eliminates the 190 MB HashAggregate spill           #
-- ###########################################################################

-- ---- Q6 OPTIMIZED PLAIN ---------------------------------------------------
SELECT postal_code, name, review_count
FROM (
    SELECT b.postal_code,
           b.name,
           b.business_id,
           COALESCE(brs.review_count, 0) AS review_count,
           RANK() OVER (PARTITION BY b.postal_code
                        ORDER BY COALESCE(brs.review_count, 0) DESC) AS rnk
    FROM business b
    LEFT JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
) t
WHERE rnk = 1
ORDER BY review_count DESC
LIMIT 100;

-- ---- Q6 OPTIMIZED EXPLAIN -------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT postal_code, name, review_count
FROM (
    SELECT b.postal_code,
           b.name,
           b.business_id,
           COALESCE(brs.review_count, 0) AS review_count,
           RANK() OVER (PARTITION BY b.postal_code
                        ORDER BY COALESCE(brs.review_count, 0) DESC) AS rnk
    FROM business b
    LEFT JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
) t
WHERE rnk = 1
ORDER BY review_count DESC
LIMIT 100;


-- ###########################################################################
-- # Q8 OPTIMIZED — rating_vs_housing (extended)                             #
-- # Original baseline: 52.4 s   |   Target: < 2 s                           #
-- # Optimization techniques used:                                           #
-- #   1. Indexing: idx_review_business_id, idx_business_postal_code         #
-- #   2. Caching: mv_business_review_summary (avg_review_stars, count)      #
-- #              mv_latest_housing (latest zhvi)                            #
-- #   3. Restructuring: Weighted-average AVG(r.stars) computed from         #
-- #      pre-aggregated business-level data (count * avg_per_business),     #
-- #      avoiding any pass over the 5.1M-row review table.                  #
-- ###########################################################################

-- ---- Q8 OPTIMIZED PLAIN ---------------------------------------------------
SELECT b.postal_code,
       z.city,
       COUNT(DISTINCT b.business_id)                       AS business_count,
       AVG(b.stars)                                        AS avg_business_rating,
       SUM(brs.avg_review_stars * brs.review_count)
         / NULLIF(SUM(brs.review_count), 0)                AS avg_review_rating,
       SUM(brs.review_count)                               AS total_reviews,
       lh.zhvi_value                                       AS latest_zhvi
FROM business b
JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
JOIN zip_region z                   ON b.postal_code = z.postal_code
JOIN mv_latest_housing lh           ON b.postal_code = lh.postal_code
GROUP BY b.postal_code, z.city, lh.zhvi_value
HAVING COUNT(DISTINCT b.business_id) >= 5
ORDER BY lh.zhvi_value DESC;

-- ---- Q8 OPTIMIZED EXPLAIN -------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT b.postal_code,
       z.city,
       COUNT(DISTINCT b.business_id)                       AS business_count,
       AVG(b.stars)                                        AS avg_business_rating,
       SUM(brs.avg_review_stars * brs.review_count)
         / NULLIF(SUM(brs.review_count), 0)                AS avg_review_rating,
       SUM(brs.review_count)                               AS total_reviews,
       lh.zhvi_value                                       AS latest_zhvi
FROM business b
JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
JOIN zip_region z                   ON b.postal_code = z.postal_code
JOIN mv_latest_housing lh           ON b.postal_code = lh.postal_code
GROUP BY b.postal_code, z.city, lh.zhvi_value
HAVING COUNT(DISTINCT b.business_id) >= 5
ORDER BY lh.zhvi_value DESC;


-- ###########################################################################
-- # Q11 OPTIMIZED — opportunity_score                                       #
-- # Original baseline: 46.0 s   |   Target: < 2 s                           #
-- # Optimization techniques used:                                           #
-- #   1. Indexing: idx_review_business_id, idx_housing_trend_trend_date     #
-- #   2. Caching: mv_business_review_summary, mv_latest_housing,            #
-- #              mv_oldest_housing (eliminates BOTH InitPlan subqueries)    #
-- #   3. Restructuring: Two MV joins replace 4 housing_trend full scans     #
-- #                     (2x InitPlan + 2x correlated lookup).               #
-- #                     Weighted AVG instead of per-row aggregation.        #
-- ###########################################################################

-- ---- Q11 OPTIMIZED PLAIN --------------------------------------------------
SELECT b.postal_code, z.city,
       COUNT(DISTINCT b.business_id)                       AS business_count,
       ROUND(AVG(b.stars)::numeric, 2)                     AS avg_business_stars,
       ROUND((SUM(brs.avg_review_stars * brs.review_count)
              / NULLIF(SUM(brs.review_count), 0))::numeric, 2)  AS avg_review_stars,
       MAX(lh.zhvi_value)                                  AS latest_zhvi,
       ROUND((MAX(lh.zhvi_value) - MIN(oh.zhvi_value))::numeric, 2) AS zhvi_growth
FROM business b
JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
JOIN zip_region z                   ON b.postal_code = z.postal_code
JOIN mv_latest_housing lh           ON b.postal_code = lh.postal_code
JOIN mv_oldest_housing oh           ON b.postal_code = oh.postal_code
GROUP BY b.postal_code, z.city
HAVING COUNT(DISTINCT b.business_id) >= 10
ORDER BY avg_review_stars DESC;

-- ---- Q11 OPTIMIZED EXPLAIN ------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT b.postal_code, z.city,
       COUNT(DISTINCT b.business_id)                       AS business_count,
       ROUND(AVG(b.stars)::numeric, 2)                     AS avg_business_stars,
       ROUND((SUM(brs.avg_review_stars * brs.review_count)
              / NULLIF(SUM(brs.review_count), 0))::numeric, 2)  AS avg_review_stars,
       MAX(lh.zhvi_value)                                  AS latest_zhvi,
       ROUND((MAX(lh.zhvi_value) - MIN(oh.zhvi_value))::numeric, 2) AS zhvi_growth
FROM business b
JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
JOIN zip_region z                   ON b.postal_code = z.postal_code
JOIN mv_latest_housing lh           ON b.postal_code = lh.postal_code
JOIN mv_oldest_housing oh           ON b.postal_code = oh.postal_code
GROUP BY b.postal_code, z.city
HAVING COUNT(DISTINCT b.business_id) >= 10
ORDER BY avg_review_stars DESC;
