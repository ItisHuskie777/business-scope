// ============================================================================
// CIS 5500 Final Project — OPTIMIZED route handlers
// ============================================================================

const pool = require('./db');


const { STATE_RE, isValidZip, clampInt, clampFloat, handleDbError } = require('./validation');


// ============================================================
// ROUTES
// ============================================================


// Route 1: GET /businesses  (generalised for the new frontend filters)
// Query params (all optional):
//   postal_code  5-digit ZIP
//   city         city name (case-sensitive)
//   state        2-letter US state code
//   min_stars    minimum stars (0–5)
//   category     exact category name, e.g. "Pizza" (see /categories)
//   open_only    "true" (default) | "false"
//   limit        rows per page (default 100, max 1000)
//   page         1-indexed page (default 1)
// Response envelope: { page, limit, rows: [...] }
const businesses = async (req, res) => {
  const { postal_code, city, state, category } = req.query;
  const openOnly = req.query.open_only !== 'false';
  const minStars = clampFloat(req.query.min_stars, 0, 0, 5);
  const limit = clampInt(req.query.limit, 100, 1, 1000);
  const page = clampInt(req.query.page, 1, 1, 100000);
  const offset = (page - 1) * limit;

  if (postal_code !== undefined && !isValidZip(postal_code)) {
    return res.status(400).json({ error: 'postal_code must be a 5-digit ZIP' });
  }
  if (state !== undefined && !STATE_RE.test(state)) {
    return res.status(400).json({ error: 'state must be a 2-letter code (e.g. PA)' });
  }

  const conditions = [];
  const params = [];
  if (postal_code) { params.push(postal_code);          conditions.push(`postal_code = $${params.length}`); }
  if (city)        { params.push(city);                  conditions.push(`city = $${params.length}`); }
  if (state)       { params.push(state.toUpperCase());   conditions.push(`state = $${params.length}`); }
  if (openOnly)    { conditions.push(`is_open = 1`); }
  if (minStars > 0){ params.push(minStars);              conditions.push(`stars >= $${params.length}`); }
  if (typeof category === 'string' && category.trim()) {
    params.push(category.trim());
    conditions.push(`EXISTS (SELECT 1 FROM mv_business_category bc
                             WHERE bc.business_id = business.business_id AND bc.category = $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);  const limitParam = `$${params.length}`;
  params.push(offset); const offsetParam = `$${params.length}`;

  const text = `
    SELECT business_id, name, address, city, state, postal_code,
           stars, is_open, categories
    FROM business
    ${where}
    ORDER BY name, business_id
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  try {
    const { rows } = await pool.query(text, params);
    res.json({ page, limit, rows });
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch businesses');
  }
};


// Route 2: GET /postal_code_stats  (unchanged)
const postalCodeStats = async (_req, res) => {
  const text = `
    SELECT postal_code, AVG(stars) AS avg_business_rating, COUNT(*) AS business_count
    FROM business
    GROUP BY postal_code
    ORDER BY avg_business_rating DESC
  `;
  try {
    const { rows } = await pool.query(text);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch postal code stats');
  }
};


// Route 3: GET /city_business_stats  (unchanged)
const cityBusinessStats = async (_req, res) => {
  const text = `
    SELECT city, COUNT(*) AS num_businesses
    FROM business
    GROUP BY city
    ORDER BY num_businesses DESC
  `;
  try {
    const { rows } = await pool.query(text);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch city business stats');
  }
};


// ============================================================
// COMPLEX QUERIES (OPTIMIZED) — Route 4, 5, 6, 8, 11
// ============================================================


// Route 4 (Complex): GET /business_review_stats   →  Q5 OPTIMIZED
// Baseline: 49.5 s  →  Optimized: 0.11 s  (445× speedup)
// Optimizations: mv_business_review_summary replaces 5.1M-row review GROUP BY;
//                CTE simplified; WHERE on indexed MV column instead of HAVING.
// Query params: min_reviews (default 50), top_n (default 5, max 50),
//               page (1-indexed, default 1), limit (default 50, max 500).
//               `offset` is still accepted and wins over `page` when given.
// Response envelope: { page, limit, offset, min_reviews, top_n, rows: [...] }
const businessReviewStats = async (req, res) => {
  const minReviews = clampInt(req.query.min_reviews, 50, 0, 100000);
  const topN       = clampInt(req.query.top_n, 5, 1, 50);
  const limit      = clampInt(req.query.limit, 50, 1, 500);
  const page       = clampInt(req.query.page, 1, 1, 100000);
  const offset     = req.query.offset !== undefined
    ? clampInt(req.query.offset, 0, 0, 1000000)
    : (page - 1) * limit;

  const text = `
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
      WHERE brs.review_count >= $1
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
    WHERE city_review_rank <= $2
    ORDER BY city, city_review_rank, total_reviews DESC, business_id
    LIMIT $3 OFFSET $4
  `;

  try {
    const { rows } = await pool.query(text, [minReviews, topN, limit, offset]);
    res.json({ page, limit, offset, min_reviews: minReviews, top_n: topN, rows });
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch business review stats');
  }
};


// Route 5 (Complex): GET /high_rated_with_housing   →  Q4 OPTIMIZED
// Baseline: 48.9 s  →  Optimized: 0.20 s  (245× speedup)
// Optimizations:
//   - Caching:       mv_business_review_summary + mv_latest_housing replace
//                    two heavy aggregations.
//   - Restructuring: HAVING → WHERE pre-filter via index.
//   - Existential:   EXISTS (zip_region with non-null state) — data-integrity
//                    check that filters out businesses in ZIPs missing state info.
// Query params: min_reviews (default 50), min_rating (default 4.0)
const highRatedWithHousing = async (req, res) => {
  const minReviews = clampInt(req.query.min_reviews, 50, 0, 100000);
  const minRating  = clampFloat(req.query.min_rating, 4.0, 0.0, 5.0);

  const text = `
    SELECT b.business_id, b.name, b.postal_code,
           brs.review_count,
           brs.avg_review_stars,
           lh.zhvi_value AS latest_zhvi
    FROM business b
    JOIN mv_business_review_summary brs ON b.business_id = brs.business_id
    LEFT JOIN mv_latest_housing lh       ON b.postal_code = lh.postal_code
    WHERE brs.review_count      >= $1
      AND brs.avg_review_stars  >  $2
      AND EXISTS (
        SELECT 1 FROM zip_region z
        WHERE z.postal_code = b.postal_code
          AND z.state IS NOT NULL
      )
    ORDER BY brs.avg_review_stars DESC
  `;

  try {
    const { rows } = await pool.query(text, [minReviews, minRating]);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch high-rated businesses with housing');
  }
};


// Route 6 (Complex): GET /top_business_per_zip   →  Q6 OPTIMIZED
// Baseline: 30.2 s  →  MV rewrite: 0.47 s  →  mv_top_business_per_zip: index read
// Optimizations:
//   - Step 1 (MS4): LEFT JOIN mv_business_review_summary replaces GROUP BY review
//     and removes the 190 MB HashAggregate disk spill; COALESCE(review_count, 0)
//     keeps businesses that were never reviewed.
//   - Step 2: the per-ZIP ranking itself is precomputed in mv_top_business_per_zip
//     (optimization/05_summary_materialized_views.sql). Its index is in the
//     same order as this ORDER BY, so LIMIT n reads n index entries instead of
//     ranking ~145k businesses per request.
// Query params: limit (default 100)
const topBusinessPerZip = async (req, res) => {
  const limit = clampInt(req.query.limit, 100, 1, 1000);

  const text = `
    SELECT postal_code, name, review_count
    FROM mv_top_business_per_zip
    ORDER BY review_count DESC, postal_code, name
    LIMIT $1
  `;

  try {
    const { rows } = await pool.query(text, [limit]);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch top business per zip');
  }
};


// Route 7: GET /housing_trend/:postal_code  (unchanged — simple time-series read)
const housingTrend = async (req, res) => {
  const { postal_code } = req.params;
  if (!isValidZip(postal_code)) {
    return res.status(400).json({ error: 'postal_code must be a 5-digit ZIP' });
  }
  const text = `
    SELECT postal_code, trend_date, zhvi_value
    FROM housing_trend
    WHERE postal_code = $1
    ORDER BY trend_date
  `;
  try {
    const { rows } = await pool.query(text, [postal_code]);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch housing trend');
  }
};


// Route 8 (Complex): GET /rating_vs_housing   →  Q8 OPTIMIZED
// Baseline: 52.4 s  →  MV rewrite: 0.75 s  →  mv_zip_summary: single index range scan
// Optimizations:
//   - Step 1 (MS4): mv_business_review_summary + mv_latest_housing remove the
//     review-table scan; AVG(r.stars) becomes a weighted average of the
//     per-business averages, which is mathematically equivalent.
//   - Step 2: the whole per-ZIP aggregate is precomputed in mv_zip_summary
//     (optimization/05_summary_materialized_views.sql), so the request no longer joins
//     four relations and groups ~145k rows; it filters ~4.7k precomputed rows.
// Query params: min_businesses (default 5)
const ratingVsHousing = async (req, res) => {
  const minBusinesses = clampInt(req.query.min_businesses, 5, 1, 1000);

  const text = `
    SELECT postal_code, city, business_count, avg_business_rating,
           avg_review_rating, total_reviews, latest_zhvi
    FROM mv_zip_summary
    WHERE business_count >= $1
    ORDER BY latest_zhvi DESC, postal_code
  `;

  try {
    const { rows } = await pool.query(text, [minBusinesses]);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch rating vs housing');
  }
};


// Route 9: GET /zip_business_count  (unchanged)
const zipBusinessCount = async (_req, res) => {
  const text = `
    SELECT z.postal_code, z.region_name, z.city, z.state, COUNT(b.business_id) AS business_count
    FROM zip_region z
    LEFT JOIN business b ON z.postal_code = b.postal_code
    GROUP BY z.postal_code, z.region_name, z.city, z.state
    ORDER BY business_count DESC
  `;
  try {
    const { rows } = await pool.query(text);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch zip business count');
  }
};


// Route 10: GET /monthly_housing  (unchanged)
const monthlyHousing = async (req, res) => {
  const { postal_code } = req.query;
  if (!isValidZip(postal_code)) {
    return res.status(400).json({ error: 'postal_code is required and must be a 5-digit ZIP' });
  }
  const text = `
    SELECT postal_code,
           DATE_TRUNC('month', trend_date)::date AS month,
           AVG(zhvi_value) AS avg_monthly_zhvi
    FROM housing_trend
    WHERE postal_code = $1
    GROUP BY postal_code, DATE_TRUNC('month', trend_date)
    ORDER BY month DESC
  `;
  try {
    const { rows } = await pool.query(text, [postal_code]);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch monthly housing');
  }
};


// Route 11 (Complex): GET /opportunity_score   →  Q11 OPTIMIZED
// Baseline: 46.0 s  →  MV rewrite: 1.14 s  →  mv_zip_summary: single index range scan
// Optimizations:
//   - Step 1 (MS4): three MVs replace two redundant housing_trend full scans
//     and the review aggregation.
//   - Step 2: mv_zip_summary stores the finished per-ZIP aggregate, including
//     the oldest ZHVI needed for growth.
//   - Universal quantifier: the original NOT EXISTS (zip_region row with a NULL
//     region_name) is the same as region_name IS NOT NULL here, because
//     postal_code is the primary key of zip_region.
// Query params: min_businesses (default 10)
const opportunityScore = async (req, res) => {
  const minBusinesses = clampInt(req.query.min_businesses, 10, 1, 10000);

  const text = `
    SELECT postal_code, city, business_count,
           ROUND(avg_business_rating::numeric, 2)           AS avg_business_stars,
           ROUND(avg_review_rating::numeric, 2)             AS avg_review_stars,
           latest_zhvi,
           ROUND((latest_zhvi - oldest_zhvi)::numeric, 2)   AS zhvi_growth
    FROM mv_zip_summary
    WHERE business_count >= $1
      AND region_name IS NOT NULL
    ORDER BY avg_review_stars DESC, postal_code
  `;

  try {
    const { rows } = await pool.query(text, [minBusinesses]);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch opportunity score');
  }
};


// ============================================================
// AUXILIARY ROUTES
// ============================================================


const cities = async (req, res) => {
  const { state } = req.query;
  if (state !== undefined && !STATE_RE.test(state)) {
    return res.status(400).json({ error: 'state must be a 2-letter code (e.g. PA)' });
  }
  const text = state
    ? `SELECT DISTINCT city, state FROM business WHERE state = $1 ORDER BY city`
    : `SELECT DISTINCT city, state FROM business ORDER BY state, city`;
  try {
    const { rows } = state
      ? await pool.query(text, [state.toUpperCase()])
      : await pool.query(text);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch cities');
  }
};


const zipCodes = async (req, res) => {
  const { city } = req.query;
  const text = city
    ? `SELECT DISTINCT postal_code, city, state
       FROM business
       WHERE city = $1 AND postal_code IS NOT NULL
       ORDER BY postal_code`
    : `SELECT DISTINCT postal_code, city, state
       FROM business
       WHERE postal_code IS NOT NULL
       ORDER BY postal_code`;
  try {
    const { rows } = city
      ? await pool.query(text, [city])
      : await pool.query(text);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch zip codes');
  }
};


const businessById = async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'business id is required' });
  }
  const text = `
    SELECT b.business_id, b.name, b.address, b.city, b.state, b.postal_code,
           b.stars, b.is_open, b.categories, b.hours,
           COALESCE(brs.review_count, 0) AS total_reviews,
           brs.avg_review_stars          AS avg_review_stars
    FROM business b
    LEFT JOIN mv_business_review_summary brs ON brs.business_id = b.business_id
    WHERE b.business_id = $1
  `;
  try {
    const { rows } = await pool.query(text, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch business');
  }
};


module.exports = {
  businesses,
  postalCodeStats,
  cityBusinessStats,
  businessReviewStats,
  highRatedWithHousing,
  topBusinessPerZip,
  housingTrend,
  ratingVsHousing,
  zipBusinessCount,
  monthlyHousing,
  opportunityScore,
  cities,
  zipCodes,
  businessById,
};
