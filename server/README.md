# Backend Server — CIS 5500 Project Group 35

Node/Express backend exposing a PostgreSQL (AWS RDS) database of Yelp businesses, reviews, and Zillow housing data.

Default port: **8080**.

---

## 1. Install dependencies

```bash
cd server
npm install
```

Requires Node.js ≥ 18. Dependencies: `express`, `pg`, `cors`.

---

## 2. Configure the database connection

Copy the example config and fill in your RDS credentials:

```bash
cp config.example.json config.json
```

Then edit `config.json`:

```json
{
  "rds_host": "cis5500-project.civkthoibwwa.us-east-1.rds.amazonaws.com",
  "rds_port": "5432",
  "rds_user": "postgres",
  "rds_password": "<RDS master password>",
  "rds_db": "postgres",
  "server_host": "localhost",
  "server_port": "8080"
}
```

`config.json` is gitignored — do NOT commit real credentials.

If you forgot the master password, reset it in AWS console → RDS → select instance → **Modify** → Credentials Settings → apply immediately.

---

## 3. Start the server

```bash
npm start
```

You should see:

```
Server running at http://localhost:8080/
```

Quick smoke test from another terminal:

```bash
curl http://localhost:8080/businesses | head -c 300
```

---

## 4. API Routes

Base URL: `http://localhost:8080`

### MS3 Query Routes (11)

Four complex queries marked with **★**.

| Method | Path | Query / Path Params | Notes |
|---|---|---|---|
| GET | `/businesses` | — | Open businesses in ZIP 19104 (Q1) |
| GET | `/postal_code_stats` | — | Avg rating + count per ZIP (Q2) |
| GET | `/city_business_stats` | — | Business count per city (Q3) |
| GET | `/high_rated_with_housing`| `min_reviews` (default 50), `min_rating` (default 4.0, 0–5) | High-rated businesses + latest ZHVI (Q4) |
| GET | `/business_review_stats` ★ | `page`, `limit` (default 50, max 500), `min_reviews` (default 50), `top_n` (default 5, 1–50) | Per-city top-N by reviews: CTE + 3 joins + `HAVING` + `RANK()`; paginated (Q5) |
| GET | `/top_business_per_zip` ★ | `limit` (default 100, 1–1000) | Top business per ZIP via RANK() (Q6) |
| GET | `/housing_trend/:postal_code` | `postal_code` (5-digit ZIP, required) | Full ZHVI time-series for a ZIP (Q7) |
| GET | `/rating_vs_housing` ★ | — | Avg business rating vs latest ZHVI by ZIP (Q8) |
| GET | `/zip_business_count` | — | Business count per ZIP + region info (Q9) |
| GET | `/monthly_housing` | `postal_code` (5-digit ZIP, required) | Monthly avg ZHVI for a ZIP (Q10) |
| GET | `/opportunity_score` ★ | `min_businesses` (default 10, 1–10000) | Neighborhood opportunity score (Q11) |

### Auxiliary Routes (3)

| Method | Path | Query / Path Params | Notes |
|---|---|---|---|
| GET | `/cities` | `state` (optional, 2-letter code) | Distinct cities for dropdowns |
| GET | `/zip_codes` | `city` (optional) | Distinct ZIPs for dropdowns |
| GET | `/business/:id` | `id` (business_id) | Full business detail + review summary; 404 if not found |

### Example requests

```bash
# Housing trend for Philadelphia University City
curl "http://localhost:8080/housing_trend/19104"

# Top 5 most-reviewed business per ZIP
curl "http://localhost:8080/top_business_per_zip?limit=5"

# Review stats: top 3 per city (≥50 reviews), page 1
curl "http://localhost:8080/business_review_stats?top_n=3&page=1&limit=20"

# Opportunity score for ZIPs with ≥20 businesses
curl "http://localhost:8080/opportunity_score?min_businesses=20"

# Single business detail
curl "http://localhost:8080/business/s55Hw6gHhQzZctinFhPu-g"
```

---

## 5. Error responses

All routes return JSON with `{ "error": "..." }` on failure.

| Status | When |
|---|---|
| 400 | Missing/invalid params (ZIP not 5 digits, state not 2 letters, etc.) |
| 404 | Resource not found (e.g. business id doesn't exist) |
| 500 | Unexpected DB/server error |
| 504 | Query timed out (>60s) — refine your filters |

---

## 6. Project structure

```
server/
├── server.js            # Express app, route registration
├── routes.js            # Route handlers + validation helpers
├── config.json          # RDS credentials (gitignored)
├── config.example.json  # Template
├── package.json
└── README.md
```
