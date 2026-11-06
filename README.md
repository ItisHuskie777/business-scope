# Business Scope: Neighborhood Business Opportunity Explorer

[![CI](https://github.com/ItisHuskie777/business-scope/actions/workflows/ci.yml/badge.svg)](https://github.com/ItisHuskie777/business-scope/actions/workflows/ci.yml)

CIS 5500 final project, Group 35.

The application joins Yelp business and review data with Zillow home values so a user can compare neighborhoods as places to open a business: how businesses there are rated, how active reviewers are, and what housing costs and how it has moved.

## Features

- **Search** from any page: by business name or category, with typing-ahead and typo tolerance.
- **Business Explorer:** filter all 145k businesses by state, city, ZIP, category, rating and open status.
- **Business detail:** review summary, monthly rating chart, a paged review feed with a star filter, and the ZIP's home value history.
- **Neighborhood analytics:** opportunity score, ratings against home values, high-rated businesses, top businesses per city.
- **Compare:** two to four ZIP codes side by side, with a shareable URL.
- **Map:** business density by city and the top business of each ZIP.

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
│   ├── 07_search_categories_reviews.sql        search indexes, category views, review feed index
│   └── 08_refresh_materialized_views.sql       refresh after a data reload
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

Seven materialized views hold precomputed results. The data is a static snapshot, so they only need a refresh when the tables are reloaded.

| View | One row per | Used by |
|---|---|---|
| `mv_business_review_summary` | business | every review-based query |
| `mv_latest_housing`, `mv_oldest_housing` | ZIP | home value and growth |
| `mv_zip_summary` | ZIP | `/rating_vs_housing`, `/opportunity_score` |
| `mv_top_business_per_zip` | ZIP (ties kept) | `/top_business_per_zip` |
| `mv_business_category` | business and category | category filter, `/categories`, `/compare` |
| `mv_category_summary` | category | `/categories` |

Search uses two GIN indexes on `business`: a trigram index on the name (partial and misspelled names, via `pg_trgm`) and a full-text index on name and categories (stemmed words). The review feed uses an index on `(business_id, review date, review_id)`, which matches its sort order.

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
cd server && npm test      # 185 API tests against a real PostgreSQL
cd client && npm test      # 40 tests: helpers, every route rendered, search box, review feed, compare page
```

The server suite needs no database setup: it starts a throwaway PostgreSQL from binaries installed with the dev dependencies, loads a small deterministic dataset and removes everything afterwards. It checks every endpoint against independently computed values, checks that each optimized query returns the same rows as the query it replaced, and covers input validation, SQL injection attempts, timeouts, database failures, the response cache, rate limiting and the OpenAPI description. It runs in a UTC+9 time zone so that date bugs show up in CI, which runs in UTC.

The client tests drive the real components: typing in the search box (one request per pause, superseded requests cancelled), paging the review feed by cursor (stale responses discarded) and the compare page (state kept in the URL).

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

After the course the RDS instance was shut down, so further work is measured with `npm run bench` in `server/`. The benchmark builds a synthetic dataset with the production row counts and times each version of the code on it.

PostgreSQL 17.5, 16 logical CPUs, default server settings. Synthetic data: 144,789 businesses, 5,128,678 reviews, 1,058,862 housing rows. Median of 7 runs (3 for the baseline). Absolute times are lower than on RDS because this is a 16-core workstation with local storage; the ratios between versions on the same machine are what the tables show.

| Endpoint | Unoptimized | Milestone 4 | Now | Now vs unoptimized | Now vs Milestone 4 |
|---|---|---|---|---|---|
| Q4 `/high_rated_with_housing` | 5.20 s | 22.6 ms | 22.6 ms | 230x | unchanged |
| Q5 `/business_review_stats` | 2.75 s | 29.8 ms | 29.8 ms | 92x | unchanged |
| Q6 `/top_business_per_zip` | 1.62 s | 120 ms | 1.18 ms | 1,378x | 101x |
| Q8 `/rating_vs_housing` | 4.43 s | 244 ms | 6.38 ms | 695x | 38x |
| Q11 `/opportunity_score` | 3.61 s | 264 ms | 9.69 ms | 372x | 27x |
| `/business/:id` (most reviewed business) | 218 ms | 149 ms | 0.77 ms | 283x | 193x |

Q6, Q8 and Q11 now read precomputed per-ZIP results (step 5) instead of joining and grouping about 145k businesses per request. `/business/:id` reads the review summary view instead of aggregating that business's reviews; the row shown is the worst case, a business with far more reviews than any real one.

| Listing and lookup endpoint | Before index | After index | Change |
|---|---|---|---|
| `businesses_by_state_city` | 7.37 ms | 1.38 ms | 5.3x |
| `businesses_first_page` | 13.2 ms | 0.83 ms | 16x |
| `cities_by_state` | 9.56 ms | 1.34 ms | 7.1x |
| `zip_codes_by_city` | 9.05 ms | 0.97 ms | 9.4x |

These four are the requests behind the Business Explorer page. Each was a sequential scan of the business table before step 6.

| New feature request | Without step 7 | With step 7 | Change |
|---|---|---|---|
| Search, prefix ("Village S") | 377 ms | 41.6 ms | 9.1x |
| Search, misspelled ("Village Star Boks") | 419 ms | 13.3 ms | 31x |
| Search, category word ("sushi") | 372 ms | 101 ms | 3.7x |
| Category counts, whole dataset | 350 ms | 0.63 ms | 551x |
| Reviews, first page | 162 ms | 0.98 ms | 166x |
| Reviews, page at row 20,000 with OFFSET | 151 ms | 63.5 ms | 2.4x |
| Reviews, page at row 20,000 with the cursor | 150 ms | 0.98 ms | 154x |

Search combines a trigram index (partial and misspelled names) with a full-text index (category words). Category counts come from a view that splits the comma-separated category field once instead of on every request. The review feed's index stores each business's reviews in feed order: with it, `OFFSET` still has to step over every earlier row, while the cursor starts exactly where the previous page ended, so a deep page costs the same as the first.

| Other new endpoint | Time |
|---|---|
| `/categories?city=` | 4.81 ms |
| `/business/:id/rating_trend` (most reviewed business) | 172 ms |
| `/compare` with 4 ZIPs | 33.6 ms |

The rating trend groups every review of the business by month; the case shown is a business with about 98,000 reviews, more than ten times the most reviewed real Yelp business, and repeat requests are served from the cache.

| HTTP request | First request | Repeat (cached) | JSON size | Sent (gzip) |
|---|---|---|---|---|
| `/rating_vs_housing` | 30.1 ms | 1.36 ms | 843 kB | 129 kB |
| `/opportunity_score` | 23.7 ms | 0.97 ms | 714 kB | 95 kB |
| `/zip_business_count` | 43.1 ms | 0.78 ms | 469 kB | 50 kB |
| `/postal_code_stats` | 37.1 ms | 1.19 ms | 481 kB | 39 kB |
| `/cities` | 14.9 ms | 0.68 ms | 150 kB | 10 kB |
| `/top_business_per_zip?limit=1000` | 5.08 ms | 0.66 ms | 69 kB | 10 kB |
| `/high_rated_with_housing` | 33.7 ms | 0.94 ms | 755 kB | 114 kB |

The data is a static snapshot, so the API keeps successful responses in memory, bounded by entry count and by bytes, together with a gzip copy of each. A repeated request is answered without touching the database or compressing again.

Building every index and materialized view took 12 s; refreshing all seven views took 4.1 s.

### Front-end bundle

Pages are loaded on demand and third-party libraries are split into separate chunks.

| First visit to | JavaScript before | JavaScript now | Now, gzip |
|---|---|---|---|
| Home page | 1,486 kB | 1,002 kB | 301 kB (was 446 kB) |
| Business Explorer | 1,486 kB | 923 kB | 290 kB |
| Compare | not available | 1,003 kB | 301 kB |
| Neighborhoods | 1,486 kB | 1,334 kB | 399 kB |
| Map | 1,486 kB | 1,486 kB | 444 kB |

Before the change every page downloaded one 1,486 kB bundle containing the data grid, the charts and the map. Now the shared shell is 592 kB (190 kB gzip), including the search box present on every page, and each page adds only the libraries it uses. A duplicate render-blocking Leaflet stylesheet loaded from a CDN on every page was also removed.

### Correctness fixes found while adding tests

- `/business_review_stats` ignored the documented `page` parameter, so every page returned the first page. It now pages correctly.
- `/businesses` sorted by name only. Many businesses share a name, so rows could repeat or go missing between pages. The sort now has a unique tie-breaker.
- The server opened one database connection at start-up and never released it.
- Dates were converted through the server's time zone. On a server east of UTC every housing date came back as the previous day. Dates and timestamps are now returned as stored.

