'use strict';

// Handlers added after the course: search, categories, the review feed, the
// rating trend and the neighborhood comparison. They rely on the objects built
// by optimization/07_search_categories_reviews.sql.

const pool = require('./db');
const { STATE_RE, isValidZip, clampInt, singleString, handleDbError } = require('./validation');

// The expression must match idx_business_search_fts exactly, or the index is not used.
const SEARCH_DOCUMENT = "to_tsvector('english', coalesce(b.name, '') || ' ' || coalesce(b.categories, ''))";

// Escape LIKE wildcards so a user typing "%" or "_" searches for that character.
const escapeLike = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);


// GET /search?q=&limit=&city=&state=
//
// Finds businesses whose name or categories match the text, for the search box.
// A business qualifies through any of three matches, each served by a GIN index:
//   - the name contains the text           (ILIKE, trigram index): typing ahead, "starb"
//   - the name is similar to the text      (word similarity, trigram index): typos, "starbuks"
//   - name or categories contain its words (full text, stemmed): "bakery" finds "Bakeries"
// Results are ordered by a relevance score that rewards name similarity most,
// then a full-text match, then a name that starts with the text.
const search = async (req, res) => {
  const raw = singleString(req.query.q);
  const q = raw === undefined ? '' : raw.trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 100) {
    return res.status(400).json({ error: 'q must be 2 to 100 characters' });
  }
  const city = singleString(req.query.city);
  const state = singleString(req.query.state);
  if (state !== undefined && !STATE_RE.test(state)) {
    return res.status(400).json({ error: 'state must be a 2-letter code (e.g. PA)' });
  }
  const limit = clampInt(req.query.limit, 10, 1, 50);

  const params = [q, escapeLike(q), limit];
  const filters = [];
  if (city) { params.push(city); filters.push(`b.city = $${params.length}`); }
  if (state) { params.push(state.toUpperCase()); filters.push(`b.state = $${params.length}`); }

  const text = `
    WITH input AS (
      SELECT $1::text AS q, websearch_to_tsquery('english', $1) AS tsq
    )
    SELECT b.business_id, b.name, b.city, b.state, b.postal_code, b.stars, b.categories,
           ROUND((2 * word_similarity(i.q, b.name)
                  + ts_rank(${SEARCH_DOCUMENT}, i.tsq)
                  + CASE WHEN b.name ILIKE $2 || '%' THEN 0.5 ELSE 0 END)::numeric, 4) AS score
    FROM business b, input i
    WHERE (b.name ILIKE '%' || $2 || '%'
           OR i.q <% b.name
           OR ${SEARCH_DOCUMENT} @@ i.tsq)
      ${filters.map((f) => `AND ${f}`).join(' ')}
    ORDER BY score DESC, b.stars DESC, b.business_id
    LIMIT $3
  `;

  try {
    const { rows } = await pool.query(text, params);
    res.json({ q, rows });
  } catch (err) {
    handleDbError(err, res, 'Failed to search businesses');
  }
};


// GET /categories?city=&state=&min_businesses=&limit=
//
// Categories with how many businesses carry them, their average stars and their
// total reviews. Without a location the answer comes from mv_category_summary;
// with a city or state it is computed for that area.
const categories = async (req, res) => {
  const city = singleString(req.query.city);
  const state = singleString(req.query.state);
  if (state !== undefined && !STATE_RE.test(state)) {
    return res.status(400).json({ error: 'state must be a 2-letter code (e.g. PA)' });
  }
  const limit = clampInt(req.query.limit, 20, 1, 500);
  const minBusinesses = clampInt(req.query.min_businesses, 1, 1, 100000);

  let text;
  let params;
  if (!city && !state) {
    text = `
      SELECT category, business_count, ROUND(avg_stars::numeric, 2) AS avg_stars, total_reviews
      FROM mv_category_summary
      WHERE business_count >= $1
      ORDER BY business_count DESC, category
      LIMIT $2
    `;
    params = [minBusinesses, limit];
  } else {
    params = [minBusinesses, limit];
    const filters = [];
    if (city) { params.push(city); filters.push(`b.city = $${params.length}`); }
    if (state) { params.push(state.toUpperCase()); filters.push(`b.state = $${params.length}`); }
    text = `
      SELECT bc.category,
             COUNT(*)                                       AS business_count,
             ROUND(AVG(b.stars)::numeric, 2)                AS avg_stars,
             COALESCE(SUM(brs.review_count), 0)::bigint     AS total_reviews
      FROM business b
      JOIN mv_business_category bc ON bc.business_id = b.business_id
      LEFT JOIN mv_business_review_summary brs ON brs.business_id = b.business_id
      WHERE ${filters.join(' AND ')}
      GROUP BY bc.category
      HAVING COUNT(*) >= $1
      ORDER BY business_count DESC, bc.category
      LIMIT $2
    `;
  }

  try {
    const { rows } = await pool.query(text, params);
    res.json(rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch categories');
  }
};


// Cursor for the review feed: the sort key of the last row on a page. It is
// opaque to clients (base64url JSON) and checked strictly when it comes back.
const encodeCursor = (row) => Buffer.from(JSON.stringify({ k: row.sort_key, id: row.review_id })).toString('base64url');

function decodeCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const keyOk = typeof value.k === 'string' && (value.k === '-infinity' || !Number.isNaN(Date.parse(value.k.replace(' ', 'T'))));
    if (keyOk && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 64) return value;
  } catch (err) {
    // fall through
  }
  return null;
}

// GET /business/:id/reviews?limit=&cursor=&stars=
//
// Newest reviews first, paged with a cursor instead of OFFSET. The cursor holds
// the (date, review_id) of the last row returned, and the next page starts
// strictly after it. idx_review_business_date stores reviews in exactly this
// order, so every page is a single index range scan: page 500 costs the same as
// page 1, where OFFSET would read and discard every earlier row.
// Response: { rows, next_cursor } where next_cursor is null on the last page.
const businessReviews = async (req, res) => {
  const { id } = req.params;
  const limit = clampInt(req.query.limit, 20, 1, 100);
  const cursorParam = singleString(req.query.cursor);
  const starsParam = singleString(req.query.stars);

  let cursor = null;
  if (cursorParam !== undefined) {
    cursor = decodeCursor(cursorParam);
    if (!cursor) return res.status(400).json({ error: 'cursor is not valid' });
  }
  let stars = null;
  if (starsParam !== undefined) {
    stars = Number(starsParam);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'stars must be a whole number from 1 to 5' });
    }
  }

  const params = [id, limit + 1];
  const conditions = ['r.business_id = $1'];
  if (cursor) {
    params.push(cursor.k, cursor.id);
    conditions.push(`(COALESCE(r.review_date, '-infinity'::timestamp), r.review_id) < ($${params.length - 1}::timestamp, $${params.length})`);
  }
  if (stars !== null) {
    params.push(stars);
    conditions.push(`r.stars = $${params.length}`);
  }

  const text = `
    SELECT r.review_id, r.stars, r.useful, r.funny, r.cool, r.text, r.review_date,
           COALESCE(r.review_date, '-infinity'::timestamp)::text AS sort_key
    FROM review r
    WHERE ${conditions.join(' AND ')}
    ORDER BY COALESCE(r.review_date, '-infinity'::timestamp) DESC, r.review_id DESC
    LIMIT $2
  `;

  try {
    // Distinguish "no such business" (404) from "no reviews on this page" (empty list).
    const [exists, page] = await Promise.all([
      pool.query('SELECT 1 FROM business WHERE business_id = $1', [id]),
      pool.query(text, params),
    ]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    const hasMore = page.rows.length > limit;
    const rows = hasMore ? page.rows.slice(0, limit) : page.rows;
    res.json({
      rows: rows.map(({ sort_key: _sortKey, ...row }) => row),
      next_cursor: hasMore ? encodeCursor(rows[rows.length - 1]) : null,
    });
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch reviews');
  }
};


// GET /business/:id/rating_trend
//
// Average stars and number of reviews per calendar month, oldest first.
// Reviews without a date are left out. Reads only this business's reviews,
// through idx_review_business_date.
const ratingTrend = async (req, res) => {
  const { id } = req.params;
  const text = `
    SELECT DATE_TRUNC('month', review_date)::date AS month,
           COUNT(*)                               AS review_count,
           ROUND(AVG(stars)::numeric, 3)          AS avg_stars
    FROM review
    WHERE business_id = $1 AND review_date IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  `;
  try {
    const [exists, trend] = await Promise.all([
      pool.query('SELECT 1 FROM business WHERE business_id = $1', [id]),
      pool.query(text, [id]),
    ]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    res.json(trend.rows);
  } catch (err) {
    handleDbError(err, res, 'Failed to fetch rating trend');
  }
};


// GET /compare?zips=19104,19103
//
// Side-by-side profile of 2 to 4 ZIP codes, returned in the order requested:
// business count and ratings, reviews, latest home value and its change over
// the past year, and the most common categories. A ZIP the dataset does not
// know is returned with found = false rather than failing the request.
const compare = async (req, res) => {
  const raw = singleString(req.query.zips);
  const zips = raw === undefined ? [] : raw.split(',').map((z) => z.trim()).filter(Boolean);
  if (zips.length < 2 || zips.length > 4) {
    return res.status(400).json({ error: 'zips must list 2 to 4 ZIP codes, separated by commas' });
  }
  if (!zips.every(isValidZip)) {
    return res.status(400).json({ error: 'each ZIP must be 5 digits' });
  }
  if (new Set(zips).size !== zips.length) {
    return res.status(400).json({ error: 'zips must not repeat' });
  }

  const text = `
    SELECT input.postal_code,
           (z.postal_code IS NOT NULL OR biz.business_count > 0)          AS found,
           COALESCE(z.city, biz.city)                                     AS city,
           COALESCE(z.state, biz.state)                                   AS state,
           z.region_name,
           biz.business_count,
           biz.open_count,
           ROUND(biz.avg_stars::numeric, 2)                               AS avg_business_stars,
           biz.total_reviews,
           ROUND(biz.avg_review_stars::numeric, 2)                        AS avg_review_stars,
           latest.zhvi_value                                              AS latest_zhvi,
           latest.trend_date                                              AS latest_date,
           year_ago.zhvi_value                                            AS zhvi_one_year_ago,
           ROUND((100 * (latest.zhvi_value - year_ago.zhvi_value)
                  / NULLIF(year_ago.zhvi_value, 0))::numeric, 2)          AS zhvi_change_pct,
           COALESCE(cats.top_categories, '[]'::json)                      AS top_categories
    FROM unnest($1::text[]) WITH ORDINALITY AS input(postal_code, position)
    LEFT JOIN zip_region z ON z.postal_code = input.postal_code
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int                                   AS business_count,
             COUNT(*) FILTER (WHERE b.is_open = 1)::int     AS open_count,
             AVG(b.stars)                                    AS avg_stars,
             COALESCE(SUM(brs.review_count), 0)::bigint      AS total_reviews,
             SUM(brs.avg_review_stars * brs.review_count)
               / NULLIF(SUM(brs.review_count), 0)            AS avg_review_stars,
             MIN(b.city)                                     AS city,
             MIN(b.state)                                    AS state
      FROM business b
      LEFT JOIN mv_business_review_summary brs ON brs.business_id = b.business_id
      WHERE b.postal_code = input.postal_code
    ) biz
    LEFT JOIN mv_latest_housing latest ON latest.postal_code = input.postal_code
    LEFT JOIN LATERAL (
      SELECT h.zhvi_value
      FROM housing_trend h
      WHERE h.postal_code = input.postal_code
        AND h.trend_date <= latest.trend_date - INTERVAL '1 year'
      ORDER BY h.trend_date DESC
      LIMIT 1
    ) year_ago ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('category', t.category, 'business_count', t.n)
                      ORDER BY t.n DESC, t.category) AS top_categories
      FROM (
        SELECT bc.category, COUNT(*)::int AS n
        FROM business b
        JOIN mv_business_category bc ON bc.business_id = b.business_id
        WHERE b.postal_code = input.postal_code
        GROUP BY bc.category
        ORDER BY n DESC, bc.category
        LIMIT 5
      ) t
    ) cats ON TRUE
    ORDER BY input.position
  `;

  try {
    const { rows } = await pool.query(text, [zips]);
    res.json({ zips: rows });
  } catch (err) {
    handleDbError(err, res, 'Failed to compare ZIP codes');
  }
};


module.exports = { search, categories, businessReviews, ratingTrend, compare, decodeCursor, encodeCursor, escapeLike };
