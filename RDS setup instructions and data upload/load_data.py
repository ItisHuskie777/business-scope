"""
Load clean CSV data into PostgreSQL RDS using COPY for efficiency.
Usage: python load_data.py
"""

import psycopg2
import os

# ── Database connection ──────────────────────────────────────────────────────
DB_CONFIG = {
    "host":     "cis5500-project.civkthoibwwa.us-east-1.rds.amazonaws.com",
    "port":     5432,
    "dbname":   "postgres",
    "user":     "postgres",
    "password": os.environ.get("PGPASSWORD", ""),
    "sslmode":  "require",
}

# ── Data file paths ──────────────────────────────────────────────────────────
DATA_DIR = os.path.join(os.path.dirname(__file__), "clean_data", "untitled folder 2")

FILES = {
    "zip_region": os.path.join(DATA_DIR, "zip_region.csv"),
    "business":   os.path.join(DATA_DIR, "business_clean.csv"),
    "review":     os.path.join(DATA_DIR, "reviews_clean_final.csv"),
    "housing_trend": os.path.join(DATA_DIR, "housing_trend.csv"),
}

# ── Column mappings (CSV header → table columns, in order) ──────────────────
COLUMNS = {
    "zip_region":    "postal_code,region_id,region_name,region_type,state_name,state,city,county_name",
    "business":      "business_id,name,address,city,state,postal_code,stars,is_open,categories,hours",
    "review":        "review_id,business_id,stars,useful,funny,cool,text,review_date",
    "housing_trend": "postal_code,trend_date,zhvi_value",
}


def load_table(conn, table: str):
    filepath = FILES[table]
    columns  = COLUMNS[table]
    print(f"Loading {table} from {os.path.basename(filepath)} ...", flush=True)
    with conn.cursor() as cur:
        with open(filepath, "r", encoding="utf-8") as f:
            next(f)  # skip header row
            cur.copy_expert(
                f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv, NULL '', QUOTE '\"')",
                f,
            )
    conn.commit()
    print(f"  Done: {table}", flush=True)


def main():
    conn = psycopg2.connect(**DB_CONFIG)
    try:
        # Load in dependency order
        for table in ["zip_region", "business", "review", "housing_trend"]:
            load_table(conn, table)
        print("\nAll tables loaded successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
