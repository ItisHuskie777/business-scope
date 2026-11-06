-- ============================================================================
-- Refresh every materialized view after the base tables are reloaded.
-- ============================================================================
-- Order matters: each view is refreshed after the views it reads.
-- CONCURRENTLY keeps each view readable while it rebuilds; it needs the unique
-- index every view already has.
-- ============================================================================

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_business_review_summary;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_latest_housing;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_oldest_housing;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_zip_summary;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_business_per_zip;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_business_category;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_category_summary;

ANALYZE mv_business_review_summary;
ANALYZE mv_latest_housing;
ANALYZE mv_oldest_housing;
ANALYZE mv_zip_summary;
ANALYZE mv_top_business_per_zip;
ANALYZE mv_business_category;
ANALYZE mv_category_summary;
