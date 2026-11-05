# Business Scope: Neighborhood Business Opportunity Explorer

[![CI](https://github.com/ItisHuskie777/business-scope/actions/workflows/ci.yml/badge.svg)](https://github.com/ItisHuskie777/business-scope/actions/workflows/ci.yml)

CIS 5500 final project, Group 35.

The application joins Yelp business and review data with Zillow home values so a user can compare neighborhoods as places to open a business: how businesses there are rated, how active reviewers are, and what housing costs and how it has moved.

**Data:** Yelp Open Dataset (businesses, reviews) and the Zillow Home Value Index (ZHVI) by ZIP code.

**Stack:** PostgreSQL · Node.js / Express · React (Vite, MUI) · Python for data preparation · Jest and Vitest · GitHub Actions.

## Team

- Carrie Li: data processing, database, query optimization, backend
- Colin Yu: Business Explorer feature
- Eitan: Neighborhood Analytics feature
- Zihan Yang: Map and Recommendation feature

## Repository layout

```
├── Pre_process/                              Python scripts that clean the raw Yelp and Zillow files
├── RDS setup instructions and data upload/   Table definitions and the CSV loader
├── optimization/                             Query optimization, in the order the steps were applied
│   ├── 01_baseline_complex_queries.sql         the five complex queries as first written
│   ├── 02_create_indexes.sql                   indexes on the base tables
│   ├── 03_create_materialized_views.sql        per-business review summary, latest and oldest home value per ZIP
│   ├── 04_optimized_queries.sql                the complex queries rewritten on top of those views
│   ├── 05_summary_materialized_views.sql       finished per-ZIP answers for three endpoints
│   ├── 06_lookup_indexes.sql                   indexes for the listing and lookup endpoints
│   └── 07_refresh_materialized_views.sql       refresh after a data reload
├── server/                                   Express API, tests and benchmark (see server/README.md)
├── client/                                   React single-page app (see client/README.md)
└── .github/workflows/ci.yml                  tests, lint and build on every push and pull request
```

## Database

Four base tables:

| Table | Contents | Rows |
|---|---|---|
| `zip_region` | ZIP code with region, city, state and county | 4,683 |
| `business` | Yelp business: name, location, stars, categories | 144,789 |
| `review` | Yelp review: stars, text, useful/funny/cool votes | 5,128,678 |
| `housing_trend` | Zillow home value by ZIP code and month | 1,115,632 |

Five materialized views hold precomputed results. The data is a static snapshot, so they only need a refresh when the tables are reloaded.

| View | One row per | Used by |
|---|---|---|
| `mv_business_review_summary` | business | every review-based query |
| `mv_latest_housing`, `mv_oldest_housing` | ZIP | home value and growth |
| `mv_zip_summary` | ZIP | `/rating_vs_housing`, `/opportunity_score` |
| `mv_top_business_per_zip` | ZIP (ties kept) | `/top_business_per_zip` |

## Running it

The AWS RDS instance used during the course has been shut down. To run the project, point it at any PostgreSQL 14 or newer.

```bash
# 1. API
cd server
npm install
export PGHOST=localhost PGUSER=postgres PGPASSWORD=... PGDATABASE=postgres
npm run db:schema      # create the tables
# load the cleaned CSV files with "RDS setup instructions and data upload/load_data.py"
npm run db:derived     # build indexes and materialized views
npm start              # http://localhost:8080

# 2. Web app
cd ../client
npm install
npm run dev            # http://localhost:5173
```

Configuration is read from environment variables; no credentials are stored in the repository. `server/README.md` lists every variable and endpoint.

## Tests and CI

```bash
cd server && npm test      # API tests against a real PostgreSQL
cd client && npm test      # unit tests
```

The server suite needs no database setup: it starts a throwaway PostgreSQL from binaries installed with the dev dependencies, loads a small deterministic dataset and removes everything afterwards. It checks every endpoint against independently computed values, checks that each optimized query returns the same rows as the query it replaced, and covers input validation, SQL injection attempts, timeouts, database failures and the response cache.

GitHub Actions runs the server suite against a PostgreSQL service container with coverage thresholds, and lints, tests and builds the client.

## Performance

### Query optimization on AWS RDS (measured during the course)

The five complex queries each took 30 to 52 seconds as first written, because every one of them aggregated the 5.1M-row review table per request. Indexes, three materialized views and query rewrites (optimization steps 2 to 4) brought them under 1.2 seconds on the course RDS instance.

| Query | Before | After | Speedup |
|---|---|---|---|
| Q4 `/high_rated_with_housing` | 48.9 s | 0.20 s | 245x |
| Q5 `/business_review_stats` | 49.5 s | 0.11 s | 445x |
| Q6 `/top_business_per_zip` | 30.2 s | 0.47 s | 64x |
| Q8 `/rating_vs_housing` | 52.4 s | 0.75 s | 70x |
| Q11 `/opportunity_score` | 46.0 s | 1.14 s | 40x |

### Later work, measured locally

After the course the RDS instance was shut down, so further work is measured with `npm run bench` in `server/`. The benchmark builds a synthetic dataset with the production row counts and times three versions of the code on it: the unoptimized handlers, the Milestone 4 queries, and the current handlers.

PostgreSQL 17.5, 16 logical CPUs, default server settings. Synthetic data: 144,789 businesses, 5,128,678 reviews, 1,058,862 housing rows. Median of 7 runs (3 for the baseline). Absolute times are lower than on RDS because this is a 16-core workstation with local storage; the ratios between versions on the same machine are what the tables show.

| Endpoint | Unoptimized | Milestone 4 | Now | Now vs unoptimized | Now vs Milestone 4 |
|---|---|---|---|---|---|
| Q4 `/high_rated_with_housing` | 5.29 s | 16.6 ms | 16.6 ms | 318x | unchanged |
| Q5 `/business_review_stats` | 2.55 s | 21.0 ms | 21.0 ms | 121x | unchanged |
| Q6 `/top_business_per_zip` | 1.62 s | 112 ms | 0.60 ms | 2,684x | 185x |
| Q8 `/rating_vs_housing` | 4.43 s | 248 ms | 5.60 ms | 791x | 44x |
| Q11 `/opportunity_score` | 3.47 s | 279 ms | 7.71 ms | 450x | 36x |
| `/business/:id` (most reviewed business) | 215 ms | 158 ms | 0.55 ms | 389x | 287x |

Q6, Q8 and Q11 now read precomputed per-ZIP results (step 5) instead of joining and grouping about 145k businesses per request. `/business/:id` reads the review summary view instead of aggregating that business's reviews; the row shown is the worst case, a business with far more reviews than any real one.

| Listing and lookup endpoint | Before index | After index | Change |
|---|---|---|---|
| `businesses_by_state_city` | 7.94 ms | 1.12 ms | 7.1x |
| `businesses_first_page` | 13.7 ms | 0.67 ms | 20x |
| `cities_by_state` | 10.1 ms | 1.28 ms | 7.9x |
| `zip_codes_by_city` | 8.96 ms | 0.75 ms | 12x |

These four are the requests behind the Business Explorer page. Each was a sequential scan of the business table before step 6.

| HTTP request | First request | Repeat (cached) | JSON size | Sent (gzip) |
|---|---|---|---|---|
| `/rating_vs_housing` | 24.0 ms | 1.24 ms | 844 kB | 129 kB |
| `/opportunity_score` | 20.3 ms | 0.86 ms | 714 kB | 95 kB |
| `/zip_business_count` | 41.0 ms | 0.83 ms | 469 kB | 50 kB |
| `/postal_code_stats` | 34.1 ms | 0.79 ms | 481 kB | 39 kB |
| `/cities` | 12.2 ms | 0.64 ms | 150 kB | 10 kB |
| `/top_business_per_zip?limit=1000` | 5.05 ms | 0.67 ms | 64 kB | 8 kB |
| `/high_rated_with_housing` | 31.1 ms | 1.00 ms | 728 kB | 102 kB |

The data is a static snapshot, so the API keeps successful responses in memory, bounded by entry count and by bytes, together with a gzip copy of each. A repeated request is answered without touching the database or compressing again.

Building every index and materialized view took 6 s; refreshing all five views took 2.9 s.

### Front-end bundle

Pages are loaded on demand and third-party libraries are split into separate chunks.

| First visit to | JavaScript before | JavaScript after | After, gzip |
|---|---|---|---|
| Home page | 1,486 kB | 976 kB | 294 kB (was 446 kB) |
| Business Explorer | 1,486 kB | 908 kB | 286 kB |
| Neighborhoods | 1,486 kB | 1,309 kB | 393 kB |
| Map | 1,486 kB | 1,461 kB | 439 kB |

Before the change every page downloaded one 1,486 kB bundle containing the data grid, the charts and the map. Now the shared shell is 538 kB (171 kB gzip) and each page adds only the libraries it uses. A duplicate render-blocking Leaflet stylesheet loaded from a CDN on every page was also removed.

### Correctness fixes found while adding tests

- `/business_review_stats` ignored the documented `page` parameter, so every page returned the first page. It now pages correctly.
- `/businesses` sorted by name only. Many businesses share a name, so rows could repeat or go missing between pages. The sort now has a unique tie-breaker.
- The server opened one database connection at start-up and never released it.

