// Unoptimized MS3 handlers, kept as the baseline for benchmarks and equivalence tests.
// The running server uses routes_optimized.js.
const pool = require('./db');


// ============================================================
// VALIDATION HELPERS
// ============================================================

const ZIP_RE = /^\d{5}$/;
const STATE_RE = /^[A-Za-z]{2}$/;

// Validate a ZIP code (must be exactly 5 digits).
const isValidZip = (zip) => typeof zip === 'string' && ZIP_RE.test(zip);

// Parse an integer query param within [min, max]; returns fallback on invalid input.
const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

// Parse a float query param within [min, max]; returns fallback on invalid input.
const clampFloat = (raw, fallback, min, max) => {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

// Wrap DB errors. 57014 = statement_timeout; map to 504 so client knows it's a timeout.
const handleDbError = (err, res, fallbackMsg) => {
  console.error(err);
  if (err && err.code === '57014') {
    return res.status(504).json({ error: 'Query timed out — please refine your filters' });
  }
  res.status(500).json({ error: fallbackMsg });
};


// ROUTES


// Route 1: GET /businesses
// Corresponds to MS3 Query 1
// Query params: postal_code (default 19104)
const businesses = async (req, res) => {
  const text = `
    SELECT business_id, name, city, stars, categories
    FROM business
    WHERE postal_code = '19104' AND is_open = 1
  `;

  try {
    const { rows } = await pool.query(text);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch businesses');
  }
};

// Route 2: GET /postal_code_stats
// Corresponds to MS3 Query 2
// Query params: none
const postalCodeStats = async (req, res) => {
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


// Route 3: GET /city_business_stats
// Corresponds to MS3 Query 3
// Query params: none
const cityBusinessStats = async (req, res) => {
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

// Route 4: GET /high_rated_with_housing
// Corresponds to MS3 Query 4
// Query params: min_reviews (default 50), min_rating (default 4.0)
const highRatedWithHousing = async (req, res) => {
  const minReviews = clampInt(req.query.min_reviews, 50, 0, 100000);
  const minRating = clampFloat(req.query.min_rating, 4.0, 0.0, 5.0);

  const text = `
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
    HAVING COUNT(r.review_id) >= $1
       AND AVG(r.stars) > $2
    ORDER BY avg_review_stars DESC
  `;

  try {
    const { rows } = await pool.query(text, [minReviews, minRating]);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch high-rated businesses with housing');
  }
};


// Route 5 (Complex): GET /business_review_stats
// Corresponds to MS3 Query 5
// Query params: page, limit, min_reviews (default 50), top_n (default 5, max 50)
const businessReviewStats = async (req, res) => {
  const page = clampInt(req.query.page, 1, 1, 100000);
  const limit = clampInt(req.query.limit, 50, 1, 500);
  const offset = (page - 1) * limit;
  const minReviews = clampInt(req.query.min_reviews, 50, 0, 100000);
  const topN = clampInt(req.query.top_n, 5, 1, 50);

  const text = `
    WITH review_agg AS (
      SELECT b.business_id,
             b.name,
             b.postal_code,
             z.city,
             COUNT(r.review_id) AS total_reviews,
             AVG(r.stars)       AS avg_review_rating,
             AVG(r.useful)      AS avg_useful,
             AVG(r.funny)       AS avg_funny,
             AVG(r.cool)        AS avg_cool
      FROM business b
      JOIN review r ON b.business_id = r.business_id
      JOIN zip_region z ON b.postal_code = z.postal_code
      GROUP BY b.business_id, b.name, b.postal_code, z.city
      HAVING COUNT(r.review_id) >= $1
    ),
    ranked AS (
      SELECT ra.*,
             RANK() OVER (PARTITION BY city ORDER BY total_reviews DESC) AS city_review_rank
      FROM review_agg ra
    )
    SELECT business_id,
           name,
           postal_code,
           city,
           total_reviews,
           avg_review_rating,
           avg_useful,
           avg_funny,
           avg_cool,
           city_review_rank
    FROM ranked
    WHERE city_review_rank <= $2
    ORDER BY city, city_review_rank, total_reviews DESC
    LIMIT $3 OFFSET $4
  `;

  try {
    const { rows } = await pool.query(text, [minReviews, topN, limit, offset]);
    res.json({ page, limit, min_reviews: minReviews, top_n: topN, rows });
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch business review stats');
  }
};



// Optimized Version of Route 5
// WITH review_stats AS (
//   SELECT r.business_id,
//          COUNT(*)      AS total_reviews,
//          AVG(r.stars)  AS avg_review_rating,
//          AVG(r.useful) AS avg_useful,
//          AVG(r.funny)  AS avg_funny,
//          AVG(r.cool)   AS avg_cool
//   FROM review r
//   GROUP BY r.business_id
//   HAVING COUNT(*) >= $1
// ),
// enriched AS (
//   SELECT b.business_id,
//          b.name,
//          b.postal_code,
//          z.city,
//          rs.total_reviews,
//          rs.avg_review_rating,
//          rs.avg_useful,
//          rs.avg_funny,
//          rs.avg_cool
//   FROM review_stats rs
//   JOIN business b   ON b.business_id = rs.business_id
//   JOIN zip_region z ON z.postal_code = b.postal_code
// ),
// ranked AS (
//   SELECT e.*,
//          RANK() OVER (PARTITION BY e.city ORDER BY e.total_reviews DESC) AS city_review_rank
//   FROM enriched e
// )
// SELECT business_id, name, postal_code, city,
//        total_reviews, avg_review_rating, avg_useful, avg_funny, avg_cool,
//        city_review_rank
// FROM ranked
// WHERE city_review_rank <= $2
// ORDER BY city, city_review_rank, total_reviews DESC
// LIMIT $3 OFFSET $4;

// Route 6 (Complex): GET /top_business_per_zip
// Corresponds to MS3 Query 6
// Query params: limit (default 100)
const topBusinessPerZip = async (req, res) => {
  const limit = clampInt(req.query.limit, 100, 1, 1000);

  const text = `
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
    LIMIT $1
  `;

  try {
    const { rows } = await pool.query(text, [limit]);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch top business per zip');
  }
};


// Optimized Version of Route 6
// WITH review_counts AS (
//   SELECT r.business_id, COUNT(*) AS review_count
//   FROM review r
//   GROUP BY r.business_id
// ),
// per_business AS (
//   SELECT b.postal_code,
//          b.name,
//          COALESCE(rc.review_count, 0) AS review_count
//   FROM business b
//   LEFT JOIN review_counts rc ON rc.business_id = b.business_id
//   WHERE b.postal_code IS NOT NULL
// ),
// top_per_zip AS (
//   SELECT DISTINCT ON (postal_code)
//          postal_code, name, review_count
//   FROM per_business
//   ORDER BY postal_code, review_count DESC, name
// )
// SELECT postal_code, name, review_count
// FROM top_per_zip
// ORDER BY review_count DESC
// LIMIT $1;


// Route 7: GET /housing_trend/:postal_code
// Corresponds to MS3 Query 7
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


// Route 8 (Complex): GET /rating_vs_housing
// Corresponds to MS3 Query 8
// Query params: min_businesses (default 5)
const ratingVsHousing = async (req, res) => {
  const minBusinesses = clampInt(req.query.min_businesses, 5, 1, 1000);

  const text = `
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
    HAVING COUNT(DISTINCT b.business_id) >= $1
    ORDER BY latest_zhvi DESC
  `;

  try {
    const { rows } = await pool.query(text, [minBusinesses]);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch rating vs housing');
  }
};

// Optimized Version of Route 8
// WITH latest_housing AS (
//   SELECT DISTINCT ON (postal_code)
//          postal_code,
//          zhvi_value
//   FROM housing_trend
//   ORDER BY postal_code, trend_date DESC
// )
// SELECT b.postal_code,
//        AVG(b.stars) AS avg_business_rating,
//        lh.zhvi_value AS latest_zhvi
// FROM business b
// JOIN latest_housing lh ON lh.postal_code = b.postal_code
// GROUP BY b.postal_code, lh.zhvi_value
// ORDER BY latest_zhvi DESC;


// Route 9: GET /zip_business_count
// Corresponds to MS3 Query 9
const zipBusinessCount = async (req, res) => {
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


// Route 10: GET /monthly_housing
// Corresponds to MS3 Query 10
// Query params: postal_code (required)
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


// Route 11 (Complex): GET /opportunity_score
// Corresponds to MS3 Query 11
// Query params: min_businesses (default 10)
const opportunityScore = async (req, res) => {
  const minBusinesses = clampInt(req.query.min_businesses, 10, 1, 10000);

  const text = `
    SELECT b.postal_code, z.city,
           COUNT(DISTINCT b.business_id)          AS business_count,
           ROUND(AVG(b.stars)::numeric, 2)        AS avg_business_stars,
           ROUND(AVG(r.stars)::numeric, 2)        AS avg_review_stars,
           MAX(h_latest.zhvi_value)               AS latest_zhvi,
           ROUND((MAX(h_latest.zhvi_value) - MIN(h_oldest.zhvi_value))::numeric, 2) AS zhvi_growth
    FROM business b
    JOIN zip_region z   ON b.postal_code = z.postal_code
    JOIN review r       ON b.business_id = r.business_id
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

// Optimized Version of Route 11
// WITH bounds AS (
//   SELECT MAX(trend_date) AS max_d, MIN(trend_date) AS min_d
//   FROM housing_trend
// ),
// h_latest AS (
//   SELECT ht.postal_code, ht.zhvi_value
//   FROM housing_trend ht
//   JOIN bounds b ON ht.trend_date = b.max_d
// ),
// h_oldest AS (
//   SELECT ht.postal_code, ht.zhvi_value
//   FROM housing_trend ht
//   JOIN bounds b ON ht.trend_date = b.min_d
// ),
// review_by_business AS (
//   SELECT r.business_id,
//          COUNT(*)            AS review_count,
//          SUM(r.stars)::float AS sum_review_stars
//   FROM review r
//   GROUP BY r.business_id
// )
// SELECT b.postal_code,
//        z.city,
//        COUNT(*) AS business_count,
//        ROUND(AVG(b.stars)::numeric, 2) AS avg_business_stars,
//        ROUND(
//          (SUM(COALESCE(rbb.sum_review_stars, 0)) / NULLIF(SUM(COALESCE(rbb.review_count, 0)), 0))::numeric
//        , 2) AS avg_review_stars,
//        MAX(hl.zhvi_value) AS latest_zhvi,
//        ROUND((MAX(hl.zhvi_value) - MAX(ho.zhvi_value))::numeric, 2) AS zhvi_growth
// FROM business b
// JOIN zip_region z ON z.postal_code = b.postal_code
// LEFT JOIN review_by_business rbb ON rbb.business_id = b.business_id
// JOIN h_latest hl ON hl.postal_code = b.postal_code
// JOIN h_oldest ho ON ho.postal_code = b.postal_code
// GROUP BY b.postal_code, z.city
// HAVING COUNT(*) >= $1
// ORDER BY avg_review_stars DESC NULLS LAST;


// ============================================================
// AUXILIARY ROUTES (not tied to MS3 queries; support the UI)
// ============================================================

// Aux 1: GET /cities
// Returns distinct cities (optionally filtered by state).
// Used for front-end dropdowns / filters.
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


// Aux 2: GET /zip_codes
// Returns distinct ZIP codes with city/state (optionally filtered by city).
// Used for front-end filter dropdowns.
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


// Aux 3: GET /business/:id
// Returns full details for a single business, including review summary.
// Used for the business detail page.
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
