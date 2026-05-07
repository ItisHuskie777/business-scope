import axios from "axios";

/**
 * Base URL of the Express backend. Falls back to localhost so the app still
 * runs when VITE_API_URL is not defined. See client/.env.example.
 */
export const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8080";

const api = axios.create({
  baseURL: API_URL,
  timeout: 65000,
});

/**
 * Normalized error surfaced by every wrapper below. Consumers can read
 * `status` to distinguish 400 (bad input), 404 (not found), 504 (timeout)
 * and branch UI accordingly.
 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status ?? 0;
    const message =
      error.response?.data?.error ||
      error.message ||
      "Unknown network error";
    return Promise.reject(new ApiError(message, status));
  }
);

// ---------------------------------------------------------------------------
// MS3 query routes (11)
// ---------------------------------------------------------------------------

/**
 * GET /businesses  —  Q1 (parameterised)
 *
 * All filters are optional; backend applies them with AND semantics.
 *
 * @param {Object} [opts]
 * @param {string} [opts.postal_code] 5-digit ZIP
 * @param {string} [opts.city]
 * @param {string} [opts.state]       2-letter code, case-insensitive
 * @param {number} [opts.min_stars]   0–5
 * @param {boolean}[opts.open_only=true]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=100]   max 1000
 * @returns {Promise<{page:number, limit:number, rows:Array<{
 *   business_id:string, name:string, address:string|null,
 *   city:string, state:string, postal_code:string,
 *   stars:number, is_open:number, categories:string|null
 * }>}>}
 */
export const getBusinesses = ({
  postal_code,
  city,
  state,
  min_stars,
  open_only,
  page = 1,
  limit = 100,
} = {}) =>
  api
    .get("/businesses", {
      params: {
        postal_code,
        city,
        state,
        min_stars,
        open_only: open_only === false ? "false" : undefined,
        page,
        limit,
      },
    })
    .then((r) => r.data);

/**
 * GET /postal_code_stats  —  Q2
 * @returns {Promise<Array<{postal_code:string,avg_business_rating:number,business_count:number}>>}
 */
export const getPostalCodeStats = () =>
  api.get("/postal_code_stats").then((r) => r.data);

/**
 * GET /city_business_stats  —  Q3
 * @returns {Promise<Array<{city:string,num_businesses:number}>>}
 */
export const getCityBusinessStats = () =>
  api.get("/city_business_stats").then((r) => r.data);

/**
 * GET /business_review_stats  —  Q5 (complex, paginated)
 *
 * Per-city top-N businesses by total reviews. Backend uses a CTE + 3-way
 * join (business × review × zip_region), a `HAVING` filter on review count,
 * and `RANK() OVER (PARTITION BY city ORDER BY total_reviews DESC)`.
 *
 * @param {Object}  [opts]
 * @param {number}  [opts.page=1]         Page number (1-indexed).
 * @param {number}  [opts.limit=50]       Rows per page (max 500).
 * @param {number}  [opts.min_reviews=50] Minimum review count per business.
 * @param {number}  [opts.top_n=5]        Keep top-N per city (max 50).
 * @returns {Promise<{
 *   page:number,
 *   limit:number,
 *   min_reviews:number,
 *   top_n:number,
 *   rows:Array<{
 *     business_id:string,
 *     name:string,
 *     postal_code:string,
 *     city:string,
 *     total_reviews:number,
 *     avg_review_rating:number,
 *     avg_useful:number,
 *     avg_funny:number,
 *     avg_cool:number,
 *     city_review_rank:number,
 *   }>
 * }>}
 */
export const getBusinessReviewStats = ({
  page = 1,
  limit = 50,
  min_reviews,
  top_n,
} = {}) =>
  api
    .get("/business_review_stats", {
      params: { page, limit, min_reviews, top_n },
    })
    .then((r) => r.data);

/**
 * GET /high_rated_with_housing  —  Q4 (complex)
 * @param {{min_reviews?:number, min_rating?:number}} [opts]
 */
export const getHighRatedWithHousing = ({
  min_reviews,
  min_rating,
} = {}) =>
  api
    .get("/high_rated_with_housing", {
      params: { min_reviews, min_rating },
    })
    .then((r) => r.data);

/**
 * GET /top_business_per_zip  —  Q6 (complex)
 * @param {{limit?:number}} [opts]
 */
export const getTopBusinessPerZip = ({ limit = 100 } = {}) =>
  api.get("/top_business_per_zip", { params: { limit } }).then((r) => r.data);

/**
 * GET /housing_trend/:postal_code  —  Q7
 * @param {string} postal_code — must be a 5-digit ZIP
 */
export const getHousingTrend = (postal_code) =>
  api
    .get(`/housing_trend/${encodeURIComponent(postal_code)}`)
    .then((r) => r.data);

/**
 * GET /rating_vs_housing  —  Q8 (complex)
 *
 * ZIP-level aggregates: avg business stars, latest ZHVI, optional city/counts.
 *
 * @param {Object} [opts]
 * @param {number} [opts.min_businesses=5] Only include ZIPs with at least this many distinct businesses.
 */
export const getRatingVsHousing = ({ min_businesses } = {}) =>
  api
    .get("/rating_vs_housing", {
      params:
        min_businesses != null && min_businesses !== ""
          ? { min_businesses }
          : {},
    })
    .then((r) => r.data);

/**
 * GET /zip_business_count  —  Q9
 */
export const getZipBusinessCount = () =>
  api.get("/zip_business_count").then((r) => r.data);

/**
 * GET /monthly_housing  —  Q10
 * @param {string} postal_code — required, 5-digit ZIP
 */
export const getMonthlyHousing = (postal_code) =>
  api
    .get("/monthly_housing", { params: { postal_code } })
    .then((r) => r.data);

/**
 * GET /opportunity_score  —  Q11 (complex)
 * @param {{min_businesses?:number}} [opts]
 */
export const getOpportunityScore = ({ min_businesses = 10 } = {}) =>
  api
    .get("/opportunity_score", { params: { min_businesses } })
    .then((r) => r.data);

// ---------------------------------------------------------------------------
// Auxiliary routes (3)
// ---------------------------------------------------------------------------

/**
 * GET /cities  —  distinct cities (optionally filtered by 2-letter state).
 * @param {string} [state]
 */
export const getCities = (state) =>
  api.get("/cities", { params: state ? { state } : {} }).then((r) => r.data);

/**
 * GET /zip_codes  —  distinct ZIPs (optionally filtered by city).
 * @param {string} [city]
 */
export const getZipCodes = (city) =>
  api.get("/zip_codes", { params: city ? { city } : {} }).then((r) => r.data);

/**
 * GET /business/:id  —  full business detail + review summary. 404 if missing.
 * @param {string} id
 */
export const getBusinessById = (id) =>
  api.get(`/business/${encodeURIComponent(id)}`).then((r) => r.data);
