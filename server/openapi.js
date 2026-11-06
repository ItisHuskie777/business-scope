'use strict';

// OpenAPI 3.1 description of the API, served at GET /openapi.json.
// test/openapi.test.js fails if a route is added to the app without being listed here.

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });

const query = (name, schema, required = false) => ({ name, in: 'query', required, schema, description: schema.description });
const path = (name, schema) => ({ name, in: 'path', required: true, schema, description: schema.description });

const zipParam = (name = 'postal_code', where = 'query', required = true) => ({
  name, in: where, required, description: '5-digit ZIP code', schema: { type: 'string', pattern: '^\\d{5}$' },
});
const stateParam = query('state', str('2-letter state code, case-insensitive', { pattern: '^[A-Za-z]{2}$' }));

const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const ok = (description, schema) => ({
  description,
  content: { 'application/json': { schema } },
});

const arrayOf = (ref) => ({ type: 'array', items: { $ref: `#/components/schemas/${ref}` } });
const objectRows = (extra, ref) => ({
  type: 'object',
  properties: { ...extra, rows: arrayOf(ref) },
});

// Every operation can fail with these.
const COMMON_ERRORS = {
  429: errorResponse('Rate limit exceeded; see the Retry-After header'),
  500: errorResponse('Unexpected server or database error'),
  504: errorResponse('The query exceeded the statement timeout'),
};

function op(summary, { params = [], response, errors = {}, tags = ['Data'] }) {
  return {
    get: {
      summary,
      tags,
      parameters: params,
      responses: { 200: response, ...errors, ...COMMON_ERRORS },
    },
  };
}

const BAD_INPUT = { 400: errorResponse('Invalid input') };
const NOT_FOUND = { 404: errorResponse('Unknown business id') };
const generic = (description) => ok(description, { type: 'array', items: { type: 'object' } });

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Business Scope API',
    version: '2.0.0',
    description:
      'Yelp businesses and reviews joined with Zillow home values. All responses are JSON. ' +
      'Successful GET responses are cached in memory (X-Cache: HIT or MISS) and gzip-compressed on request.',
  },
  components: {
    schemas: {
      Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
      Business: {
        type: 'object',
        properties: {
          business_id: str('Yelp business id'), name: str('Name'), address: str('Street address'),
          city: str('City'), state: str('State code'), postal_code: str('ZIP code'),
          stars: str('Yelp star rating, 1.0 to 5.0 (numeric as string)'), is_open: int('1 if open'),
          categories: str('Comma-separated categories'),
        },
      },
      SearchHit: {
        type: 'object',
        properties: {
          business_id: str('Yelp business id'), name: str('Name'), city: str('City'), state: str('State code'),
          postal_code: str('ZIP code'), stars: str('Star rating'), categories: str('Comma-separated categories'),
          score: str('Relevance score; higher is better'),
        },
      },
      Category: {
        type: 'object',
        properties: {
          category: str('Category name'), business_count: int('Businesses carrying it'),
          avg_stars: str('Average star rating'), total_reviews: int('Reviews of those businesses'),
        },
      },
      Review: {
        type: 'object',
        properties: {
          review_id: str('Review id'), stars: str('Stars given, 1 to 5'), useful: int('Useful votes'),
          funny: int('Funny votes'), cool: int('Cool votes'), text: str('Review text'),
          review_date: str('Timestamp, or null', { format: 'date-time' }),
        },
      },
      ZipProfile: {
        type: 'object',
        properties: {
          postal_code: str('ZIP code'), found: { type: 'boolean', description: 'false if the dataset does not know this ZIP' },
          city: str('City'), state: str('State code'), region_name: str('Zillow region name'),
          business_count: int('Businesses'), open_count: int('Open businesses'),
          avg_business_stars: str('Average Yelp stars'), total_reviews: int('Reviews'),
          avg_review_stars: str('Average stars over all reviews'), latest_zhvi: str('Latest home value (USD)'),
          latest_date: str('Date of the latest home value'), zhvi_one_year_ago: str('Home value a year earlier'),
          zhvi_change_pct: str('Change over the year, percent'),
          top_categories: {
            type: 'array',
            items: { type: 'object', properties: { category: str('Category'), business_count: int('Businesses') } },
          },
        },
      },
    },
  },
  paths: {
    '/businesses': op('List businesses with optional filters, sorted by name', {
      params: [
        zipParam('postal_code', 'query', false), query('city', str('City name')), stateParam,
        query('min_stars', num('Minimum stars', { minimum: 0, maximum: 5 })),
        query('category', str('Exact category name, see /categories')),
        query('open_only', str('"false" to include closed businesses', { enum: ['true', 'false'] })),
        query('page', int('1-based page', { minimum: 1 })),
        query('limit', int('Rows per page', { minimum: 1, maximum: 1000, default: 100 })),
      ],
      response: ok('One page of businesses', objectRows({ page: int('Page'), limit: int('Limit') }, 'Business')),
      errors: BAD_INPUT,
    }),
    '/postal_code_stats': op('Average rating and business count per ZIP', { response: generic('One row per ZIP') }),
    '/city_business_stats': op('Business count per city', { response: generic('One row per city') }),
    '/business_review_stats': op('Top N businesses per city by review count', {
      params: [
        query('min_reviews', int('Minimum reviews', { default: 50 })),
        query('top_n', int('Businesses kept per city', { minimum: 1, maximum: 50, default: 5 })),
        query('page', int('1-based page', { minimum: 1 })),
        query('limit', int('Rows per page', { minimum: 1, maximum: 500, default: 50 })),
        query('offset', int('Row offset; overrides page')),
      ],
      response: generic('Paged envelope { page, limit, offset, min_reviews, top_n, rows }'),
    }),
    '/high_rated_with_housing': op('Well-reviewed businesses with the latest home value of their ZIP', {
      params: [
        query('min_reviews', int('Minimum reviews', { default: 50 })),
        query('min_rating', num('Average review stars must exceed this', { default: 4.0 })),
      ],
      response: generic('One row per business'),
    }),
    '/top_business_per_zip': op('Most reviewed business of each ZIP', {
      params: [query('limit', int('Rows', { minimum: 1, maximum: 1000, default: 100 }))],
      response: generic('One row per ZIP (ties kept)'),
    }),
    '/housing_trend/{postal_code}': op('Home value time series of a ZIP', {
      params: [zipParam('postal_code', 'path')], response: generic('One row per reading, oldest first'), errors: BAD_INPUT,
    }),
    '/rating_vs_housing': op('Ratings against the latest home value, per ZIP', {
      params: [query('min_businesses', int('Minimum businesses in the ZIP', { default: 5 }))],
      response: generic('One row per ZIP'),
    }),
    '/zip_business_count': op('Business count per ZIP with region details', { response: generic('One row per ZIP') }),
    '/monthly_housing': op('Monthly average home value of a ZIP', {
      params: [zipParam()], response: generic('One row per month, newest first'), errors: BAD_INPUT,
    }),
    '/opportunity_score': op('Ratings, latest home value and home value growth per ZIP', {
      params: [query('min_businesses', int('Minimum businesses in the ZIP', { default: 10 }))],
      response: generic('One row per ZIP'),
    }),
    '/cities': op('Distinct cities', { params: [stateParam], response: generic('City and state'), errors: BAD_INPUT, tags: ['Lookup'] }),
    '/zip_codes': op('Distinct ZIP codes', {
      params: [query('city', str('City name'))], response: generic('ZIP, city and state'), tags: ['Lookup'],
    }),
    '/business/{id}': op('One business with its review summary', {
      params: [path('id', str('Yelp business id'))],
      response: ok('The business', { $ref: '#/components/schemas/Business' }),
      errors: NOT_FOUND,
    }),
    '/business/{id}/reviews': op('Reviews of a business, newest first, paged with a cursor', {
      params: [
        path('id', str('Yelp business id')),
        query('limit', int('Reviews per page', { minimum: 1, maximum: 100, default: 20 })),
        query('cursor', str('next_cursor from the previous page; omit for the first page')),
        query('stars', int('Only reviews with exactly this many stars', { minimum: 1, maximum: 5 })),
      ],
      response: ok('One page', {
        type: 'object',
        properties: { rows: arrayOf('Review'), next_cursor: { type: ['string', 'null'], description: 'null on the last page' } },
      }),
      errors: { ...BAD_INPUT, ...NOT_FOUND },
      tags: ['Features'],
    }),
    '/business/{id}/rating_trend': op('Average stars and review count per month', {
      params: [path('id', str('Yelp business id'))],
      response: ok('One row per month, oldest first', {
        type: 'array',
        items: { type: 'object', properties: { month: str('First day of the month'), review_count: int('Reviews'), avg_stars: str('Average stars') } },
      }),
      errors: NOT_FOUND,
      tags: ['Features'],
    }),
    '/search': op('Search businesses by name or category; tolerates typos and partial words', {
      params: [
        query('q', str('Search text, 2 to 100 characters', { minLength: 2, maxLength: 100 }), true),
        query('limit', int('Results', { minimum: 1, maximum: 50, default: 10 })),
        query('city', str('Only this city')), stateParam,
      ],
      response: ok('Best matches first', objectRows({ q: str('The normalized query') }, 'SearchHit')),
      errors: BAD_INPUT,
      tags: ['Features'],
    }),
    '/categories': op('Categories by number of businesses, dataset-wide or for a city or state', {
      params: [
        query('city', str('Only this city')), stateParam,
        query('min_businesses', int('Minimum businesses per category', { default: 1 })),
        query('limit', int('Rows', { minimum: 1, maximum: 500, default: 20 })),
      ],
      response: ok('Most common first', arrayOf('Category')),
      errors: BAD_INPUT,
      tags: ['Features'],
    }),
    '/compare': op('Side-by-side profile of 2 to 4 ZIP codes', {
      params: [query('zips', str('Comma-separated ZIP codes, 2 to 4, no repeats', { example: '19104,19103' }), true)],
      response: ok('Profiles in the order requested', { type: 'object', properties: { zips: arrayOf('ZipProfile') } }),
      errors: BAD_INPUT,
      tags: ['Features'],
    }),
    '/health': {
      get: {
        summary: 'Liveness and database readiness',
        tags: ['Service'],
        responses: { 200: generic('{ status: "ok", cache }'), 503: errorResponse('Database unreachable') },
      },
    },
    '/openapi.json': {
      get: { summary: 'This document', tags: ['Service'], responses: { 200: { description: 'OpenAPI 3.1 JSON' } } },
    },
  },
};

module.exports = spec;
