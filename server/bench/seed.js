'use strict';

// Generates a synthetic dataset with the same row counts and table shapes as the
// production snapshot (README: 4,683 ZIPs, 144,789 businesses, 5,128,678 reviews,
// 1,115,632 housing rows). Values are random but the distributions are skewed the
// way the real data is: a few ZIPs hold many businesses, a few businesses hold
// most reviews, and businesses differ in how well they are rated. Review text is ~530 bytes so the review table is several GB, as
// on RDS; that width is what makes a sequential scan of it expensive.

const FULL = { zips: 4683, businesses: 144789, reviews: 5128678, months: 238 };

function sizes(scale) {
  return {
    zips: Math.max(20, Math.round(FULL.zips * Math.min(1, scale * 4))),
    businesses: Math.max(200, Math.round(FULL.businesses * scale)),
    reviews: Math.max(2000, Math.round(FULL.reviews * scale)),
    months: FULL.months,
  };
}

const STATES = "ARRAY['PA','FL','TN','AZ','IN','MO','LA','NJ','NV','CA','ID','DE','IL','AB']";

async function seed(client, scale = 1, log = () => {}) {
  const n = sizes(scale);
  await client.query('SELECT setseed(0.55)');

  log(`zip_region: ${n.zips} rows`);
  await client.query(`
    INSERT INTO zip_region
    SELECT lpad((10000 + g)::text, 5, '0'), g,
           CASE WHEN g % 97 = 0 THEN NULL ELSE 'Region ' || g END,
           'zip', 'State ' || (g % 14),
           CASE WHEN g % 211 = 0 THEN NULL ELSE (${STATES})[1 + g % 14] END,
           'City ' || (g % 900), 'County ' || (g % 300)
    FROM generate_series(1, ${n.zips}) g`);

  log(`business: ${n.businesses} rows`);
  await client.query(`
    INSERT INTO business
    SELECT 'b' || lpad(g::text, 9, '0'),
           'Business ' || (g % 60000),
           (g % 9999) || ' Main St',
           'City ' || (z % 900),
           (${STATES})[1 + z % 14],
           CASE WHEN r < 0.03 THEN '99' || lpad((g % 1000)::text, 3, '0')
                ELSE lpad((10000 + z)::text, 5, '0') END,
           (2 + floor(random() * 9)) / 2.0,
           (random() < 0.8)::int,
           'Restaurants, Food', NULL
    FROM (SELECT g, random() AS r, 1 + floor(${n.zips} * power(random(), 2))::int AS z
          FROM generate_series(1, ${n.businesses}) g) s`);

  log(`review: ${n.reviews} rows (this is the slow one)`);
  // Each business has its own quality level (1.5 to 5.0, derived from its number),
  // and its reviews scatter around that level. Without this every business would
  // average three stars and rating filters such as "above 4.0" would match nothing.
  await client.query(`
    INSERT INTO review
    SELECT 'r' || lpad(g::text, 10, '0'),
           'b' || lpad(bn::text, 9, '0'),
           least(5, greatest(1, round(1.5 + 3.5 * ((bn::bigint * 7919) % 1000) / 1000.0 + random() * 2 - 1))),
           floor(random() * 5), floor(random() * 3), floor(random() * 3),
           repeat('synthetic review text ', 24),
           timestamp '2015-01-01' + random() * interval '3000 days'
    FROM (SELECT g, (1 + floor(${n.businesses} * power(random(), 3)))::int AS bn
          FROM generate_series(1, ${n.reviews}) g) s`);

  const zipsWithHousing = Math.round(n.zips * 0.95);
  log(`housing_trend: ${zipsWithHousing * n.months} rows`);
  await client.query(`
    INSERT INTO housing_trend
    SELECT lpad((10000 + z)::text, 5, '0'),
           (date '2005-01-31' + (m || ' months')::interval)::date,
           round((150000 + z * 30 + m * 900 + random() * 5000)::numeric, 2)
    FROM generate_series(1, ${zipsWithHousing}) z, generate_series(0, ${n.months - 1}) m`);

  await client.query('ANALYZE');
  return n;
}

module.exports = { seed, sizes, FULL };
