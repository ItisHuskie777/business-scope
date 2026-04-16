const { Pool, types } = require('pg');
const config = require('./config.json')

// Override the default parsing for BIGINT (PostgreSQL type ID 20)
types.setTypeParser(20, val => parseInt(val, 10)); //DO NOT DELETE THIS

// Create PostgreSQL connection using database credentials provided in config.json
// Do not edit. If the connection fails, make sure to check that config.json is filled out correctly
const pool = new Pool({
  host: config.rds_host,
  user: config.rds_user,
  password: config.rds_password,
  port: config.rds_port,
  database: config.rds_db,
  ssl: {
    rejectUnauthorized: false,
  },
});
pool.connect((err) => err && console.log(err));


// ROUTES


// Route 1: GET /businesses

const businesses = async (req, res) => {
  const text = `
    SELECT business_id, name, city, stars, categories
    FROM business
    WHERE postal_code = '19104' AND is_open = 1
  `;

  try {
    const { rows } = await pool.query(text);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch businesses' });
  }
};

// Route 2: GET /postal_code_stats
const postalCodeStats = async (req, res) => {
  const text = `
    SELECT postal_code, AVG(stars) AS avg_business_rating, COUNT(*) AS business_count
    FROM business
    GROUP BY postal_code
    ORDER BY avg_business_rating DESC
  `;

  try {
    const { rows } = await pool.query(text);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch postal code stats' });
  }
};


// Route 3: GET /city_business_stats
const cityBusinessStats = async (req, res) => {
  const text = `
    SELECT city, COUNT(*) AS num_businesses
    FROM business
    GROUP BY city
    ORDER BY num_businesses DESC
  `;

  try {
    const { rows } = await pool.query(text);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch city business stats' });
  }
};


// Route 4: GET /business_review_stats
const businessReviewStats = async (req, res) => {
  const text = `
    SELECT b.name,
           COUNT(r.review_id) AS total_reviews,
           AVG(r.stars) AS avg_review_rating,
           SUM(r.useful) AS total_useful,
           SUM(r.funny) AS total_funny,
           SUM(r.cool) AS total_cool
    FROM business b
    LEFT JOIN review r ON b.business_id = r.business_id
    GROUP BY b.business_id, b.name
    ORDER BY total_reviews DESC
  `;

  try {
    const { rows } = await pool.query(text);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch business review stats' });
  }
};

module.exports = {
  businesses,
  postalCodeStats,
  cityBusinessStats,
  businessReviewStats,
};
