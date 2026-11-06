# Backend Server

Node/Express API over a PostgreSQL database of Yelp businesses and reviews and Zillow housing values.

Default port: **8080**. Requires Node.js 18 or newer.

---

## 1. Install

```bash
cd server
npm install
```

## 2. Configure the database connection

Configuration comes from environment variables. Nothing secret is stored in the repository.

| Variable | Default | Meaning |
|---|---|---|
| `PGHOST` | `localhost` | Database host |
| `PGPORT` | `5432` | Database port |
| `PGUSER` | `postgres` | Database user |
| `PGPASSWORD` | none | Database password |
| `PGDATABASE` | `postgres` | Database name |
| `PGSSL` | on for remote hosts, off for `localhost` | Set `true` or `false` to override |
| `PORT` | `8080` | Port the API listens on |
| `CORS_ORIGIN` | `*` | Allowed origin for browsers |
| `CACHE_TTL_MS` | `300000` | Lifetime of a cached response; `0` turns the cache off |
| `CACHE_MAX_ENTRIES` | `500` | Most responses kept in memory |
| `CACHE_MAX_BYTES` | `67108864` | Most bytes of responses kept in memory |
| `PG_POOL_MAX` | `10` | Connection pool size |
| `PG_STATEMENT_TIMEOUT_MS` | `60000` | Per-query timeout |
| `RATE_LIMIT_PER_MINUTE` | `300` | Sustained requests per minute per client; `0` turns limiting off |
| `RATE_LIMIT_BURST` | `60` | Requests a client may send at once |
| `TRUST_PROXY` | `0` | Proxies in front of the API, so client addresses come from `X-Forwarded-For` |

A git-ignored `config.json` in the course format (see `config.example.json`) is still read as a fallback. Environment variables take priority.

## 3. Prepare the database

```bash
npm run db:schema     # create the four empty tables
# load the CSV data (see "RDS setup instructions and data upload/")
npm run db:derived    # build indexes and materialized views
```

After reloading data, refresh the materialized views with `optimization/08_refresh_materialized_views.sql`. Step 7 needs the `pg_trgm` extension, which ships with PostgreSQL and is available on AWS RDS.

## 4. Start

```bash
npm start
curl http://localhost:8080/health
```

---

## 5. API

Base URL: `http://localhost:8080`. Every route is `GET` and returns JSON. The full machine-readable description is served at **`/openapi.json`** (OpenAPI 3.1); a test fails if a route is added without being documented there.

### Query routes

Complex queries are marked ★.

| Path | Parameters | Returns |
|---|---|---|
| `/businesses` | `postal_code`, `city`, `state`, `min_stars` (0–5), `category`, `open_only` (default `true`), `page` (default 1), `limit` (default 100, max 1000) | `{ page, limit, rows }`, filters combined with AND, sorted by name |
| `/postal_code_stats` | none | Average rating and business count per ZIP |
| `/city_business_stats` | none | Business count per city |
| `/high_rated_with_housing` ★ | `min_reviews` (default 50), `min_rating` (default 4.0) | Well-reviewed businesses with the latest home value of their ZIP |
| `/business_review_stats` ★ | `min_reviews` (default 50), `top_n` (default 5, max 50), `page` (default 1), `limit` (default 50, max 500) | `{ page, limit, offset, min_reviews, top_n, rows }`, top N businesses per city by review count |
| `/top_business_per_zip` ★ | `limit` (default 100, max 1000) | Most reviewed business of each ZIP |
| `/housing_trend/:postal_code` | 5-digit ZIP | Home value time series |
| `/rating_vs_housing` ★ | `min_businesses` (default 5) | Ratings against the latest home value, per ZIP |
| `/zip_business_count` | none | Business count per ZIP with region details |
| `/monthly_housing` | `postal_code` (required) | Monthly average home value |
| `/opportunity_score` ★ | `min_businesses` (default 10) | Ratings, latest home value and home value growth, per ZIP |

### Search, categories, reviews and comparison

| Path | Parameters | Returns |
|---|---|---|
| `/search` | `q` (2–100 characters, required), `limit` (default 10, max 50), `city`, `state` | `{ q, rows }`, best match first. Matches partial names ("starb"), misspelled names ("starbuks") and category words with stemming ("bakery" finds "Bakeries") |
| `/categories` | `city`, `state`, `min_businesses` (default 1), `limit` (default 20, max 500) | Categories with business count, average stars and total reviews, most common first |
| `/business/:id/reviews` | `limit` (default 20, max 100), `cursor`, `stars` (1–5) | `{ rows, next_cursor }`, newest first. Pass `next_cursor` back to get the next page; it is `null` on the last page |
| `/business/:id/rating_trend` | business id | Average stars and review count per month, oldest first |
| `/compare` | `zips`: 2 to 4 ZIP codes, comma-separated | `{ zips }` in the order requested: businesses, ratings, reviews, latest home value, change over a year, top 5 categories. An unknown ZIP comes back with `found: false` |

The review feed pages with a cursor rather than `OFFSET`. The cursor encodes the date and id of the last review returned, and an index stores each business's reviews in that order, so a page deep in the feed costs the same as the first one.

### Lookup and service routes

| Path | Parameters | Returns |
|---|---|---|
| `/cities` | `state` (optional, 2 letters) | Distinct cities |
| `/zip_codes` | `city` (optional) | Distinct ZIPs |
| `/business/:id` | business id | Business details and review summary; 404 if unknown |
| `/health` | none | `200 { status: "ok" }` when the database answers, `503` otherwise |
| `/openapi.json` | none | OpenAPI 3.1 description of every route |

### Errors

Every failure is JSON of the form `{ "error": "..." }`.

| Status | When |
|---|---|
| 400 | Invalid input, for example a ZIP that is not 5 digits |
| 404 | Unknown business id or unknown route |
| 429 | Rate limit exceeded; `Retry-After` says how many seconds to wait |
| 500 | Unexpected database or server error |
| 503 | `/health` only: the database is unreachable |
| 504 | The query exceeded the statement timeout |

### Rate limiting

Each client address has a token bucket: it may send `RATE_LIMIT_BURST` requests at once, refilled at `RATE_LIMIT_PER_MINUTE`. Responses carry `RateLimit-Limit` and `RateLimit-Remaining`. `/health` is exempt. Cached responses count too, so the cache cannot be used to get around the limit. Behind a load balancer, set `TRUST_PROXY` or every client shares one bucket.

### Dates

Dates are returned exactly as stored: `YYYY-MM-DD` for dates and `YYYY-MM-DDTHH:MM:SS` for timestamps, with no time zone conversion.

### Caching and compression

The data is a static snapshot, so successful responses are kept in memory for `CACHE_TTL_MS` and reused. The `X-Cache` response header says `HIT` or `MISS`. The cache evicts the least recently used entries once it reaches `CACHE_MAX_ENTRIES` or `CACHE_MAX_BYTES`.

Responses are gzip-compressed when the client accepts it. Each cached entry also keeps its gzip copy, so a hit sends stored bytes instead of compressing the same body again.

---

## 6. Tests

```bash
npm test                # 185 tests against a real PostgreSQL
npm run test:coverage   # same, with coverage thresholds enforced
```

The suite needs no setup. It starts a throwaway PostgreSQL 17 from the binaries installed with the dev dependencies, loads a small deterministic dataset, builds the indexes and materialized views, and removes everything afterwards. To run against your own database instead, set `PGHOST` and the other `PG*` variables; CI does this with a service container.

What is covered:

- **Correctness.** Each endpoint is checked against values computed in plain JavaScript from the fixture rows.
- **Equivalence.** The optimized queries are compared with the unoptimized handlers in `routes.js` and with the Milestone 4 SQL, so a rewrite cannot silently change results.
- **Validation and injection.** Bad input gets a 400, numeric parameters are clamped, and quoted input cannot alter a query.
- **Failure handling.** Timeouts map to 504, other database errors to 500, and driver messages never reach the client.
- **Cache.** Expiry, eviction by count and by size, and that a repeated request does not reach the database.
- **New features.** Search by prefix, typo and category; category counts; walking the whole review feed by cursor, including undated reviews and ties on date; monthly rating trend; ZIP comparison, including unknown ZIPs and ZIPs without housing data.
- **Rate limiting.** Bursts, refill, `Retry-After`, per-client buckets and bounded memory.
- **API description.** Every route the app serves is in `/openapi.json` and every schema reference resolves.
- **Time zones.** The suite runs in `Asia/Tokyo`, so a date that shifts with the server's time zone fails here and in CI.

## 7. Benchmark

```bash
npm run bench                    # production row counts; several GB and 10 to 20 minutes
BENCH_SCALE=0.05 npm run bench   # quick run on 5% of the data
```

The script generates a synthetic dataset with the production row counts and then measures, in order: the unoptimized handlers before any index or view exists; the Milestone 4 queries; the lookup endpoints before and after their indexes; every current handler; and the HTTP layer with the cache cold and warm. Results are written to `bench/results.json`. See the project README for the latest numbers.

---

## 8. Layout

```
server/
├── server.js             entry point: listen and graceful shutdown
├── app.js                builds the Express app (used by server.js and by tests)
├── config.js             environment-first configuration
├── db.js                 shared connection pool
├── cache.js              in-memory response cache and its middleware
├── routes_optimized.js   handlers for the original endpoints
├── routes_features.js    search, categories, review feed, rating trend, comparison
├── validation.js         input helpers shared by the route modules
├── rateLimit.js          token-bucket rate limiter and its middleware
├── openapi.js            OpenAPI 3.1 description, served at /openapi.json
├── routes.js             unoptimized handlers, kept as the benchmark and test baseline
├── db/                   schema setup, SQL runner, local PostgreSQL for tests
├── bench/                data generator and benchmark
└── test/                 Jest suites, fixtures and helpers
```
