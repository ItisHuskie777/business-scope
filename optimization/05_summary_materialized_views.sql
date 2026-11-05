-- ============================================================================
-- Optimization step 5: precomputed summaries
-- ============================================================================
-- Run after 03_create_materialized_views.sql (these views read the ones built there).
--
-- Step 3 removed the 5.1M-row review scan from every complex query. Three
-- endpoints still did real work per request on top of those views:
--
--   /rating_vs_housing  (Q8)   join business (~145k rows) with three views and
--   /opportunity_score  (Q11)  zip_region, then group down to one row per ZIP
--   /top_business_per_zip (Q6) rank all ~145k businesses inside their ZIP
--
-- The data is a static snapshot, so the finished answers are stored here and a
-- request becomes a small indexed read.
--
-- server/test/equivalence.test.js checks each endpoint against the query it replaced.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- mv_zip_summary: one row per ZIP, shared by Q8 and Q11.
--
-- Equivalence with the step-4 queries:
--   * the join set is identical (business x review summary x zip_region x
--     latest housing; oldest housing exists for a ZIP whenever latest does);
--   * zip_region.postal_code and both housing views are unique per ZIP, so
--     grouping by their columns adds no rows;
--   * Q11's NOT EXISTS (zip_region row with a NULL region_name) becomes
--     region_name IS NOT NULL, because postal_code is zip_region's primary key.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_zip_summary;

CREATE MATERIALIZED VIEW mv_zip_summary AS
SELECT b.postal_code,
       z.city,
       z.region_name,
       COUNT(DISTINCT b.business_id)                  AS business_count,
       AVG(b.stars)                                   AS avg_business_rating,
       SUM(brs.avg_review_stars * brs.review_count)
         / NULLIF(SUM(brs.review_count), 0)           AS avg_review_rating,
       SUM(brs.review_count)                          AS total_reviews,
       lh.zhvi_value                                  AS latest_zhvi,
       oh.zhvi_value                                  AS oldest_zhvi
FROM business b
JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
JOIN zip_region z                   ON b.postal_code = z.postal_code
JOIN mv_latest_housing lh           ON b.postal_code = lh.postal_code
JOIN mv_oldest_housing oh           ON b.postal_code = oh.postal_code
GROUP BY b.postal_code, z.city, z.region_name, lh.zhvi_value, oh.zhvi_value;

-- Unique index: required for REFRESH ... CONCURRENTLY, and a point lookup by ZIP.
CREATE UNIQUE INDEX idx_mv_zip_summary_postal_code
  ON mv_zip_summary (postal_code);

-- Both endpoints filter on business_count >= $1.
CREATE INDEX idx_mv_zip_summary_business_count
  ON mv_zip_summary (business_count);


-- ----------------------------------------------------------------------------
-- mv_top_business_per_zip: the most reviewed business (or businesses, on a tie)
-- of every ZIP, as Q6 defines it. A business with no reviews counts as zero, so
-- a ZIP whose businesses were never reviewed still appears.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_top_business_per_zip;

CREATE MATERIALIZED VIEW mv_top_business_per_zip AS
SELECT postal_code, business_id, name, review_count
FROM (
    SELECT b.postal_code,
           b.business_id,
           b.name,
           COALESCE(brs.review_count, 0) AS review_count,
           RANK() OVER (PARTITION BY b.postal_code
                        ORDER BY COALESCE(brs.review_count, 0) DESC) AS rnk
    FROM business b
    LEFT JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
) ranked
WHERE rnk = 1;

CREATE UNIQUE INDEX idx_mv_top_business_per_zip_business_id
  ON mv_top_business_per_zip (business_id);

-- Matches the endpoint's ORDER BY, so LIMIT n reads only the first n index entries.
CREATE INDEX idx_mv_top_business_per_zip_order
  ON mv_top_business_per_zip (review_count DESC, postal_code, name);


ANALYZE mv_zip_summary;
ANALYZE mv_top_business_per_zip;
