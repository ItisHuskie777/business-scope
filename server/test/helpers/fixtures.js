'use strict';

// Small, fully deterministic dataset. It is generated from a seeded PRNG so
// every run sees the same rows, and it deliberately contains the edge cases the
// queries have to handle:
//   - a ZIP with a NULL region_name (excluded by /opportunity_score)
//   - a ZIP with a NULL state       (excluded by /high_rated_with_housing)
//   - a ZIP with no housing data    (no ZHVI; absent from the per-ZIP analytics)
//   - businesses in a ZIP that zip_region does not list
//   - a business with no reviews, closed businesses, and repeated names
//   - reviews without a date, and many reviews sharing a date

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZIPS = [
  { postal_code: '19104', region_name: 'University City', state: 'PA', state_name: 'Pennsylvania', city: 'Philadelphia', county_name: 'Philadelphia County' },
  { postal_code: '19103', region_name: 'Rittenhouse', state: 'PA', state_name: 'Pennsylvania', city: 'Philadelphia', county_name: 'Philadelphia County' },
  { postal_code: '19147', region_name: 'Bella Vista', state: 'PA', state_name: 'Pennsylvania', city: 'Philadelphia', county_name: 'Philadelphia County' },
  { postal_code: '33602', region_name: 'Downtown Tampa', state: 'FL', state_name: 'Florida', city: 'Tampa', county_name: 'Hillsborough County' },
  { postal_code: '33606', region_name: 'Hyde Park', state: 'FL', state_name: 'Florida', city: 'Tampa', county_name: 'Hillsborough County' },
  { postal_code: '37203', region_name: 'The Gulch', state: 'TN', state_name: 'Tennessee', city: 'Nashville', county_name: 'Davidson County' },
  { postal_code: '37206', region_name: null, state: 'TN', state_name: 'Tennessee', city: 'Nashville', county_name: 'Davidson County' },
  { postal_code: '85701', region_name: 'Downtown Tucson', state: null, state_name: 'Arizona', city: 'Tucson', county_name: 'Pima County' },
];

const UNLISTED_ZIP = '99999';          // has businesses, but no zip_region row
const ZIP_WITHOUT_HOUSING = '33606';   // listed, but no housing_trend rows
const NAMES = ['Starbucks', 'Blue Door Cafe', 'Corner Bakery', 'Taqueria Sol', 'Night Owl Diner', 'Green Bowl', 'Starbucks', 'Old Town Pizza'];
const STARS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];

function build() {
  const rand = mulberry32(5500);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  const zipRegion = ZIPS.map((z, i) => ({ region_id: 1000 + i, region_type: 'zip', ...z }));

  const business = [];
  const placement = [...ZIPS.map((z) => z), { postal_code: UNLISTED_ZIP, city: 'Nowhere', state: 'ZZ' }];
  placement.forEach((z, zi) => {
    const count = z.postal_code === UNLISTED_ZIP ? 3 : 8;
    for (let i = 0; i < count; i += 1) {
      business.push({
        business_id: `biz_${String(zi).padStart(2, '0')}_${String(i).padStart(2, '0')}`,
        name: NAMES[i % NAMES.length],
        address: `${100 + i} Main St`,
        city: z.city,
        state: z.state || 'AZ',
        postal_code: z.postal_code,
        stars: pick(STARS),
        is_open: rand() < 0.8 ? 1 : 0,
        categories: pick(['Coffee & Tea, Cafes', 'Restaurants, Pizza', 'Bakeries, Food', 'Mexican, Restaurants']),
        hours: null,
      });
    }
  });

  const review = [];
  business.forEach((b, bi) => {
    // First business of each ZIP gets 60-80 reviews (clears the default min_reviews = 50);
    // the last business of each ZIP gets none; the rest get 1-40.
    const index = Number(b.business_id.slice(-2));
    const isLast = business[bi + 1] === undefined || business[bi + 1].postal_code !== b.postal_code;
    let n = int(1, 40);
    if (index === 0) n = int(60, 80);
    if (isLast) n = 0;
    for (let k = 0; k < n; k += 1) {
      review.push({
        review_id: `rev_${b.business_id.slice(4)}_${String(k).padStart(3, '0')}`,
        business_id: b.business_id,
        stars: int(1, 5),
        useful: int(0, 6),
        funny: int(0, 3),
        cool: int(0, 3),
        text: 'Synthetic review text.',
        review_date: `2023-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}T12:00:00`,
      });
      // Two reviews of the first business have no date: the review feed must still page through them.
      if (b.business_id === 'biz_00_00' && k < 2) review[review.length - 1].review_date = null;
    }
  });

  const housingTrend = [];
  ZIPS.filter((z) => z.postal_code !== ZIP_WITHOUT_HOUSING).forEach((z, zi) => {
    let value = 180000 + zi * 45000;
    for (let m = 0; m < 24; m += 1) {
      const year = 2022 + Math.floor(m / 12);
      const month = (m % 12) + 1;
      value += int(-1500, 4000);
      housingTrend.push({ postal_code: z.postal_code, trend_date: `${year}-${String(month).padStart(2, '0')}-28`, zhvi_value: value + 0.5 });
      // One ZIP has two readings in some months, so the monthly average is a real average.
      if (z.postal_code === '19104' && m % 6 === 0) {
        housingTrend.push({ postal_code: z.postal_code, trend_date: `${year}-${String(month).padStart(2, '0')}-10`, zhvi_value: value - 1000 });
      }
    }
  });

  return { zipRegion, business, review, housingTrend };
}

async function insert(client, table, rows) {
  // json_populate_recordset maps JSON keys onto the table's own column types.
  await client.query(
    `INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`,
    [JSON.stringify(rows)]
  );
}

async function seed(client, data = build()) {
  await insert(client, 'zip_region', data.zipRegion);
  await insert(client, 'business', data.business);
  await insert(client, 'review', data.review);
  await insert(client, 'housing_trend', data.housingTrend);
  return data;
}

module.exports = { build, seed, ZIPS, UNLISTED_ZIP, ZIP_WITHOUT_HOUSING };
