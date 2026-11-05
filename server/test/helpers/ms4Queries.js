'use strict';

// The Q8 and Q11 queries exactly as they shipped in Milestone 4 (three
// materialized views, aggregated per request). They are kept here as the
// reference that the mv_zip_summary rewrite must reproduce row for row.

const RATING_VS_HOUSING = `
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
  HAVING COUNT(DISTINCT b.business_id) >= $1
  ORDER BY lh.zhvi_value DESC
`;

const OPPORTUNITY_SCORE = `
  SELECT b.postal_code, z.city,
         COUNT(DISTINCT b.business_id)                                AS business_count,
         ROUND(AVG(b.stars)::numeric, 2)                              AS avg_business_stars,
         ROUND((SUM(brs.avg_review_stars * brs.review_count)
                / NULLIF(SUM(brs.review_count), 0))::numeric, 2)      AS avg_review_stars,
         MAX(lh.zhvi_value)                                           AS latest_zhvi,
         ROUND((MAX(lh.zhvi_value) - MIN(oh.zhvi_value))::numeric, 2) AS zhvi_growth
  FROM business b
  JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
  JOIN zip_region z                   ON b.postal_code = z.postal_code
  JOIN mv_latest_housing lh           ON b.postal_code = lh.postal_code
  JOIN mv_oldest_housing oh           ON b.postal_code = oh.postal_code
  WHERE NOT EXISTS (
      SELECT 1 FROM zip_region z2
      WHERE z2.postal_code = b.postal_code
        AND z2.region_name IS NULL
  )
  GROUP BY b.postal_code, z.city
  HAVING COUNT(DISTINCT b.business_id) >= $1
  ORDER BY avg_review_stars DESC
`;

module.exports = { RATING_VS_HOUSING, OPPORTUNITY_SCORE };
