"""
Test all Milestone 3 SQL queries against the RDS database.
Run with: python test_queries.py
"""

import psycopg2
import os

DB_CONFIG = {
    "host":     "cis5500-project.civkthoibwwa.us-east-1.rds.amazonaws.com",
    "port":     5432,
    "dbname":   "postgres",
    "user":     "postgres",
    "password": os.environ.get("PGPASSWORD", ""),
    "sslmode":  "require",
}

QUERIES = [
    (
        "Q1: Open businesses in ZIP 19104",
        """
        SELECT business_id, name, city, stars, categories
        FROM business
        WHERE postal_code = '19104' AND is_open = 1
        LIMIT 5;
        """
    ),
    (
        "Q2: Average business rating by ZIP code",
        """
        SELECT postal_code, ROUND(AVG(stars)::numeric,2) AS avg_rating, COUNT(*) AS business_count
        FROM business
        GROUP BY postal_code
        ORDER BY avg_rating DESC
        LIMIT 5;
        """
    ),
    (
        "Q3: Business count by city",
        """
        SELECT city, COUNT(*) AS num_businesses
        FROM business
        GROUP BY city
        ORDER BY num_businesses DESC
        LIMIT 5;
        """
    ),
    (
        "Q4 (Complex): High-rated businesses with 50+ reviews + housing context",
        """
        SELECT b.business_id, b.name, b.postal_code,
               COUNT(r.review_id)  AS review_count,
               ROUND(AVG(r.stars)::numeric,2) AS avg_review_stars,
               h.zhvi_value AS latest_zhvi
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
        HAVING COUNT(r.review_id) >= 50 AND AVG(r.stars) > 4.0
        ORDER BY avg_review_stars DESC
        LIMIT 5;
        """
    ),
    (
        "Q5: Review statistics per business",
        """
        SELECT b.name,
               COUNT(r.review_id) AS total_reviews,
               ROUND(AVG(r.stars)::numeric,2) AS avg_rating,
               SUM(r.useful) AS total_useful
        FROM business b
        LEFT JOIN review r ON b.business_id = r.business_id
        GROUP BY b.business_id, b.name
        ORDER BY total_reviews DESC
        LIMIT 5;
        """
    ),
    (
        "Q6 (Complex): Most-reviewed business per ZIP (window function)",
        """
        SELECT postal_code, name, review_count
        FROM (
            SELECT b.postal_code, b.name,
                   COUNT(r.review_id) AS review_count,
                   RANK() OVER (PARTITION BY b.postal_code ORDER BY COUNT(r.review_id) DESC) AS rnk
            FROM business b
            LEFT JOIN review r ON b.business_id = r.business_id
            GROUP BY b.postal_code, b.business_id, b.name
        ) t
        WHERE rnk = 1
        ORDER BY review_count DESC
        LIMIT 5;
        """
    ),
    (
        "Q7: Housing trend for ZIP 19104",
        """
        SELECT postal_code, trend_date, zhvi_value
        FROM housing_trend
        WHERE postal_code = '19104'
        ORDER BY trend_date DESC
        LIMIT 5;
        """
    ),
    (
        "Q8 (Complex): Avg business rating vs latest housing value by ZIP",
        """
        SELECT b.postal_code,
               ROUND(AVG(b.stars)::numeric,2) AS avg_business_rating,
               h.zhvi_value AS latest_zhvi
        FROM business b
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
        GROUP BY b.postal_code, h.zhvi_value
        ORDER BY latest_zhvi DESC
        LIMIT 5;
        """
    ),
    (
        "Q9: ZIP regions with most businesses",
        """
        SELECT z.postal_code, z.region_name, z.city, z.state, COUNT(b.business_id) AS business_count
        FROM zip_region z
        LEFT JOIN business b ON z.postal_code = b.postal_code
        GROUP BY z.postal_code, z.region_name, z.city, z.state
        ORDER BY business_count DESC
        LIMIT 5;
        """
    ),
    (
        "Q10: Monthly average housing value by ZIP",
        """
        SELECT postal_code,
               DATE_TRUNC('month', trend_date) AS month,
               ROUND(AVG(zhvi_value)::numeric,2) AS avg_monthly_zhvi
        FROM housing_trend
        GROUP BY postal_code, DATE_TRUNC('month', trend_date)
        ORDER BY postal_code, month DESC
        LIMIT 5;
        """
    ),
    (
        "Q11 (Complex): Neighborhood opportunity score (business + housing + reviews)",
        """
        SELECT b.postal_code, z.city,
               COUNT(DISTINCT b.business_id) AS business_count,
               ROUND(AVG(b.stars)::numeric,2) AS avg_business_stars,
               ROUND(AVG(r.stars)::numeric,2) AS avg_review_stars,
               MAX(h_latest.zhvi_value)       AS latest_zhvi,
               ROUND((MAX(h_latest.zhvi_value) - MIN(h_oldest.zhvi_value))::numeric,2) AS zhvi_growth
        FROM business b
        JOIN zip_region z   ON b.postal_code = z.postal_code
        JOIN review r       ON b.business_id = r.business_id
        JOIN (
            SELECT postal_code, zhvi_value
            FROM housing_trend
            WHERE trend_date = (SELECT MAX(trend_date) FROM housing_trend)
        ) h_latest  ON b.postal_code = h_latest.postal_code
        JOIN (
            SELECT postal_code, zhvi_value
            FROM housing_trend
            WHERE trend_date = (SELECT MIN(trend_date) FROM housing_trend)
        ) h_oldest  ON b.postal_code = h_oldest.postal_code
        GROUP BY b.postal_code, z.city
        HAVING COUNT(DISTINCT b.business_id) >= 10
        ORDER BY avg_review_stars DESC
        LIMIT 5;
        """
    ),
]


def run_queries():
    conn = psycopg2.connect(**DB_CONFIG)
    cur  = conn.cursor()

    for title, sql in QUERIES:
        print(f"\n{'='*60}")
        print(f"  {title}")
        print('='*60)
        try:
            cur.execute(sql)
            rows = cur.fetchall()
            cols = [desc[0] for desc in cur.description]
            # Print header
            print("  " + " | ".join(f"{c:<20}" for c in cols))
            print("  " + "-" * (23 * len(cols)))
            for row in rows:
                print("  " + " | ".join(f"{str(v):<20}" for v in row))
            print(f"\n  => {len(rows)} rows returned")
        except Exception as e:
            print(f"  ERROR: {e}")
            conn.rollback()

    cur.close()
    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    run_queries()
