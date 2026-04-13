-- Drop tables if they exist (in reverse dependency order)
DROP TABLE IF EXISTS housing_trend;
DROP TABLE IF EXISTS review;
DROP TABLE IF EXISTS business;
DROP TABLE IF EXISTS zip_region;

-- 1. zip_region (no dependencies)
CREATE TABLE zip_region (
    postal_code  VARCHAR(10) PRIMARY KEY,
    region_id    BIGINT,
    region_name  VARCHAR(100),
    region_type  VARCHAR(50),
    state_name   VARCHAR(100),
    state        CHAR(2),
    city         VARCHAR(100),
    county_name  VARCHAR(100)
);

-- 2. business (postal_code kept as plain column, no FK due to incomplete zip coverage)
CREATE TABLE business (
    business_id  VARCHAR(30) PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    address      VARCHAR(255),
    city         VARCHAR(100),
    state        CHAR(2),
    postal_code  VARCHAR(10),
    stars        DECIMAL(2,1),
    is_open      INT,
    categories   TEXT,
    hours        TEXT
);

-- 3. review (depends on business)
CREATE TABLE review (
    review_id    VARCHAR(30) PRIMARY KEY,
    business_id  VARCHAR(30) NOT NULL REFERENCES business(business_id),
    stars        DECIMAL(2,1),
    useful       INT DEFAULT 0,
    funny        INT DEFAULT 0,
    cool         INT DEFAULT 0,
    text         TEXT,
    review_date  TIMESTAMP
);

-- 4. housing_trend (postal_code kept as plain column, no FK due to incomplete zip coverage)
CREATE TABLE housing_trend (
    postal_code  VARCHAR(10) NOT NULL,
    trend_date   DATE NOT NULL,
    zhvi_value   DECIMAL(12,2),
    PRIMARY KEY (postal_code, trend_date)
);
