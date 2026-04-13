# CIS 5500 Final Project – Neighborhood Business Opportunity Explorer

## Project Description

This application integrates Yelp business data with Zillow housing market data to help users identify promising neighborhoods for business investment. By combining business performance indicators (ratings, review activity, category distribution) with housing market trends (Zillow Home Value Index), the application enables data-driven exploration of neighborhood-level opportunities across multiple U.S. cities.

**Datasets used:**
- Yelp Open Dataset (businesses, reviews)
- Zillow Home Value Index (ZHVI) by ZIP code

**Tech stack:** PostgreSQL (AWS RDS) · Node.js / Express · React · Python (data processing)

---

## Team Members

- Carrie Li — Data Processing & Database
- Colin Yu — Business Explorer Feature
- Eitan — Neighborhood Analytics Feature
- Zihan Yang — Map & Recommendation Feature

---

## Repository Structure

```
├── RDS setup instructions and data upload/
│   ├── create_tables.sql      # DDL for creating all 4 database tables
│   ├── load_data.py           # Python script to load CSV data into PostgreSQL via COPY
│   └── test_queries.py        # Python script to run and verify all 10 SQL queries
│
├── preprocess_yelp.py         # Cleans and filters Yelp business dataset
├── preprocess_review.py       # Cleans and filters Yelp review dataset
├── proprocess_zip.py          # Cleans and maps ZIP code / region data
│
├── README.md                  # This file
```

---

## Database Schema

The PostgreSQL database hosted on AWS RDS contains 4 tables:

| Table | Description | Rows |
|---|---|---|
| `zip_region` | ZIP code metadata (region, city, state, county) | 4,683 |
| `business` | Yelp business info (name, location, stars, categories) | 144,789 |
| `review` | Yelp reviews (stars, text, useful/funny/cool votes) | 5,128,678 |
| `housing_trend` | Zillow ZHVI values by ZIP code and date | 1,115,632 |

---

## How to Run

### For TAs / Graders (Read-Only Access)

Connect to the database using the guest account:

```bash
psql "host=cis5500-project.civkthoibwwa.us-east-1.rds.amazonaws.com port=5432 dbname=postgres user=guest sslmode=require"
# Password: MyStr0ng@Pass2026!
```

Or use DataGrip / pgAdmin with the following settings:

| Field    | Value                                                              |
|----------|--------------------------------------------------------------------|
| Host     | cis5500-project.civkthoibwwa.us-east-1.rds.amazonaws.com          |
| Port     | 5432                                                               |
| Database | postgres                                                           |
| Username | guest                                                              |
| Password | MyStr0ng@Pass2026!                                                 |

The guest account has read-only (SELECT) access to all tables.

---

### For Team Members (Database Setup)

Only needed if the database needs to be rebuilt from scratch.

```bash
# 1. Install dependencies
pip install psycopg2-binary

# 2. Set master password
export PGPASSWORD='<postgres_master_password>'  # replace with RDS master password

# 3. Create tables
psql "host=cis5500-project.civkthoibwwa.us-east-1.rds.amazonaws.com port=5432 dbname=postgres user=postgres sslmode=require" -f "RDS setup instructions and data upload/create_tables.sql"

# 4. Load data
python "RDS setup instructions and data upload/load_data.py"

# 5. Verify queries
python "RDS setup instructions and data upload/test_queries.py"
```

### Run the Application

*(To be added in Milestone 4 once backend and frontend are set up)*
