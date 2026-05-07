const express = require('express');
const cors = require('cors');
const config = require('./config.json');
const {
  businesses,
  postalCodeStats,
  cityBusinessStats,
  businessReviewStats,
  highRatedWithHousing,
  topBusinessPerZip,
  housingTrend,
  ratingVsHousing,
  zipBusinessCount,
  monthlyHousing,
  opportunityScore,
  cities,
  zipCodes,
  businessById,
} = require('./routes_optimized');

const app = express();
app.use(cors({
  origin: '*',
}));

// API endpoints
app.get('/businesses', businesses);
app.get('/postal_code_stats', postalCodeStats);
app.get('/city_business_stats', cityBusinessStats);
app.get('/business_review_stats', businessReviewStats);
app.get('/high_rated_with_housing', highRatedWithHousing);
app.get('/top_business_per_zip', topBusinessPerZip);
app.get('/housing_trend/:postal_code', housingTrend);
app.get('/rating_vs_housing', ratingVsHousing);
app.get('/zip_business_count', zipBusinessCount);
app.get('/monthly_housing', monthlyHousing);
app.get('/opportunity_score', opportunityScore);
app.get('/cities', cities);
app.get('/zip_codes', zipCodes);
app.get('/business/:id', businessById);


app.listen(config.server_port, () => {
  console.log(`Server running at http://${config.server_host}:${config.server_port}/`)
});

module.exports = app;
