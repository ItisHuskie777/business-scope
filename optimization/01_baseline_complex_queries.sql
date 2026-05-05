-- ============================================================================
-- CIS 5500 Final Project — Step 01: BASELINE complex queries (un-optimized)
--   Q4  high_rated_with_housing
--   Q5  business_review_stats   (CTE + RANK per city)
--   Q6  top_business_per_zip
--   Q8  rating_vs_housing
--   Q11 opportunity_score
--
-- Run this file twice in DataGrip:
--   (a) BEFORE running 02_create_indexes.sql → captures "Baseline" column.
--   (b) AFTER running 02_create_indexes.sql  → captures "After Indexing".
-- For "After Caching + Restructuring", run 04_optimized_queries.sql instead.
-- ============================================================================
--
-- Use this file for live demo screenshots and the demo video. Each query has
-- two variants:
--
--   1) PLAIN  — run this to show the wall-clock execution time in DataGrip's
--               status bar / output panel ("Executed in 49 s 188 ms").
--               Good for the "watch how slow this is" moment.
--
--   2) EXPLAIN — run this to show the execution plan. Right-click the result
--               and pick "Show Visual Plan" (or Ctrl+Shift+E) to render the
--               tree-style visualization with cost/timing per node — that's
--               the screenshot you want for slides/report.
--
-- How to run a single query in DataGrip:
--   * Highlight the SELECT block (everything between the BEGIN/END markers
--     for that query) and press Ctrl+Enter (Cmd+Enter on Mac).
--   * Or click anywhere in the block and use the "Execute Statement" button.
--
-- Suggested capture workflow (BEFORE optimization):
--   1. For each query, run the PLAIN version → screenshot the timing
--   2. Run the EXPLAIN version → "Show Visual Plan" → screenshot the tree
--   3. Save screenshots into optimization/screenshots/before/
--
-- Then run optimization/02_create_indexes.sql (in psql) to build the indexes.
--
-- Suggested capture workflow (AFTER optimization):
--   Repeat steps 1–3, save into optimization/screenshots/after/.
--   Same script, same queries — only the database state changes.
-- ============================================================================


-- ###########################################################################
-- # Q4 — high_rated_with_housing                                            #
-- # Defaults: min_reviews = 50, min_rating = 4.0                            #
-- # Baseline: ~49.2 s   |   Target after optimization: < 2 s                #
-- ###########################################################################

-- ---- Q4 PLAIN -------------------------------------------------------------
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

-- ---- Q4 EXPLAIN ANALYZE ---------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
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


-- ###########################################################################
-- # Q5 — business_review_stats  (CTE + RANK per city)                       #
-- # Defaults: min_reviews = 50, top_n = 5, limit = 50, offset = 0           #
-- # Baseline: ~49.5 s   |   Target after optimization: < 2 s                #
-- ###########################################################################

-- ---- Q5 PLAIN -------------------------------------------------------------
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

-- ---- Q5 EXPLAIN ANALYZE ---------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
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


-- ###########################################################################
-- # Q6 — top_business_per_zip                                               #
-- # Defaults: limit = 100                                                   #
-- # Baseline: ~30.5 s   |   Target after optimization: < 2 s                #
-- ###########################################################################

-- ---- Q6 PLAIN -------------------------------------------------------------
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

-- ---- Q6 EXPLAIN ANALYZE ---------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
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


-- ###########################################################################
-- # Q8 — rating_vs_housing  (extended: + review join + city + business_count)
-- # Defaults: min_businesses = 5                                            #
-- # Baseline: ~52.4 s   |   Target after optimization: < 2 s                #
-- ###########################################################################

-- ---- Q8 PLAIN -------------------------------------------------------------
SELECT b.postal_code,
       z.city,
       COUNT(DISTINCT b.business_id)       AS business_count,
       AVG(b.stars)                        AS avg_business_rating,
       AVG(r.stars)                        AS avg_review_rating,
       COUNT(r.review_id)                  AS total_reviews,
       h.zhvi_value                        AS latest_zhvi
FROM business b
JOIN review r     ON b.business_id = r.business_id
JOIN zip_region z ON b.postal_code = z.postal_code
JOIN (
    SELECT ht1.postal_code, ht1.zhvi_value
    FROM housing_trend ht1
    JOIN (
        SELECT postal_code, MAX(trend_date) AS latest_date
        FROM housing_trend
        GROUP BY postal_code
    ) ht2 ON ht1.postal_code = ht2.postal_code
         AND ht1.trend_date  = ht2.latest_date
) h ON b.postal_code = h.postal_code
GROUP BY b.postal_code, z.city, h.zhvi_value
HAVING COUNT(DISTINCT b.business_id) >= 5
ORDER BY latest_zhvi DESC;

-- ---- Q8 EXPLAIN ANALYZE ---------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT b.postal_code,
       z.city,
       COUNT(DISTINCT b.business_id)       AS business_count,
       AVG(b.stars)                        AS avg_business_rating,
       AVG(r.stars)                        AS avg_review_rating,
       COUNT(r.review_id)                  AS total_reviews,
       h.zhvi_value                        AS latest_zhvi
FROM business b
JOIN review r     ON b.business_id = r.business_id
JOIN zip_region z ON b.postal_code = z.postal_code
JOIN (
    SELECT ht1.postal_code, ht1.zhvi_value
    FROM housing_trend ht1
    JOIN (
        SELECT postal_code, MAX(trend_date) AS latest_date
        FROM housing_trend
        GROUP BY postal_code
    ) ht2 ON ht1.postal_code = ht2.postal_code
         AND ht1.trend_date  = ht2.latest_date
) h ON b.postal_code = h.postal_code
GROUP BY b.postal_code, z.city, h.zhvi_value
HAVING COUNT(DISTINCT b.business_id) >= 5
ORDER BY latest_zhvi DESC;


-- ###########################################################################
-- # Q11 — opportunity_score                                                 #
-- # Defaults: min_businesses = 10                                           #
-- # Baseline: ~41.9 s   |   Target after optimization: < 2 s                #
-- ###########################################################################

-- ---- Q11 PLAIN ------------------------------------------------------------
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

-- ---- Q11 EXPLAIN ANALYZE --------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
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
