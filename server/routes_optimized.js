// ============================================================================
// CIS 5500 Final Project — OPTIMIZED route handlers
// ============================================================================

const { Pool, types } = require('pg');
const config = require('./config.json');

// Override the default parsing for BIGINT (PostgreSQL type ID 20)
types.setTypeParser(20, val => parseInt(val, 10)); // DO NOT DELETE

const pool = new Pool({
  host: config.rds_host,
  user: config.rds_user,
  password: config.rds_password,
  port: config.rds_port,
  database: config.rds_db,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 60000,
  query_timeout: 60000,
});
pool.connect((err) => err && console.log(err));


// ============================================================
// VALIDATION HELPERS
// ============================================================

const ZIP_RE = /^\d{5}$/;
const STATE_RE = /^[A-Za-z]{2}$/;

const isValidZip = (zip) => typeof zip === 'string' && ZIP_RE.test(zip);

const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const clampFloat = (raw, fallback, min, max) => {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const handleDbError = (err, res, fallbackMsg) => {
  console.error(err);
  if (err && err.code === '57014') {
    return res.status(504).json({ error: 'Query timed out — please refine your filters' });
  }
  res.status(500).json({ error: fallbackMsg });
};


// ============================================================
// ROUTES
// ============================================================


// Route 1: GET /businesses  (generalised for the new frontend filters)
// Query params (all optional):
//   postal_code  5-digit ZIP
//   city         city name (case-sensitive)
//   state        2-letter US state code
//   min_stars    minimum stars (0–5)
//   open_only    "true" (default) | "false"
//   limit        rows per page (default 100, max 1000)
//   page         1-indexed page (default 1)
// Response envelope: { page, limit, rows: [...] }
const businesses = async (req, res) => {
  const { postal_code, city, state } = req.query;
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);  const limitParam = `$${params.length}`;
  params.push(offset); const offsetParam = `$${params.length}`;

  const text = `
    SELECT business_id, name, address, city, state, postal_code,
           stars, is_open, categories
    FROM business
    ${where}
    ORDER BY name
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
// Query params: min_reviews (default 50), top_n (default 5),
//               limit (default 50, max 500), offset (default 0)
const businessReviewStats = async (req, res) => {
  const minReviews = clampInt(req.query.min_reviews, 50, 0, 100000);
  const topN       = clampInt(req.query.top_n, 5, 1, 100);
  const limit      = clampInt(req.query.limit, 50, 1, 500);
  const offset     = clampInt(req.query.offset, 0, 0, 1000000);

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
    ORDER BY city, city_review_rank, total_reviews DESC
    LIMIT $3 OFFSET $4
  `;

  try {
    const { rows } = await pool.query(text, [minReviews, topN, limit, offset]);
    res.json({ minReviews, topN, limit, offset, rows });
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
// Baseline: 30.2 s  →  Optimized: 0.47 s  (64× speedup)
// Optimizations: LEFT JOIN mv_business_review_summary replaces GROUP BY review;
//                COALESCE(review_count, 0) preserves businesses with no reviews;
//                eliminates the 190 MB HashAggregate disk spill.
// Query params: limit (default 100)
const topBusinessPerZip = async (req, res) => {
  const limit = clampInt(req.query.limit, 100, 1, 1000);

  const text = `
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
// Baseline: 52.4 s  →  Optimized: 0.75 s  (70× speedup)
// Optimizations: mv_business_review_summary + mv_latest_housing eliminate
//                review-table scan; weighted-AVG rewrite —
//                AVG(r.stars) becomes SUM(avg_per_business * count) / SUM(count),
//                mathematically equivalent but avoids touching review entirely.
// Query params: min_businesses (default 5)
const ratingVsHousing = async (req, res) => {
  const minBusinesses = clampInt(req.query.min_businesses, 5, 1, 1000);

  const text = `
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
// Baseline: 46.0 s  →  Optimized: 1.14 s  (40× speedup)
// Optimizations:
//   - Caching:       mv_business_review_summary + mv_latest_housing +
//                    mv_oldest_housing replace TWO redundant housing_trend
//                    full scans (InitPlan MIN/MAX).
//   - Restructuring: weighted-AVG rewrite for review stars; merge-join via MV
//                    unique indexes is preferred over hash-join.
//   - Universal:     NOT EXISTS (zip_region with null region_name) — exclude
//                    ZIPs lacking complete region metadata so the opportunity
//                    score is only computed on data-quality-clean rows.
// Query params: min_businesses (default 10)
const opportunityScore = async (req, res) => {
  const minBusinesses = clampInt(req.query.min_businesses, 10, 1, 10000);

  const text = `
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

  try {
    const { rows } = await pool.query(text, [minBusinesses]);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch opportunity score');
  }
};


// ============================================================
// AUXILIARY ROUTES (unchanged)
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
           COUNT(r.review_id) AS total_reviews,
           AVG(r.stars)       AS avg_review_stars
    FROM business b
    LEFT JOIN review r ON b.business_id = r.business_id
    WHERE b.business_id = $1
    GROUP BY b.business_id
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
