const express = require('express');
const cors = require('cors');
const config = require('./config.json');
const {
  businesses,
  postalCodeStats,
  cityBusinessStats,
  businessReviewStats,
} = require('./routes');

const app = express();
app.use(cors({
  origin: '*',
}));

// API endpoints
app.get('/businesses', businesses);
app.get('/postal_code_stats', postalCodeStats);
app.get('/city_business_stats', cityBusinessStats);
app.get('/business_review_stats', businessReviewStats);


app.listen(config.server_port, () => {
  console.log(`Server running at http://${config.server_host}:${config.server_port}/`)
});

module.exports = app;
