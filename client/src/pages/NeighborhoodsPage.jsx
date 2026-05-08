import { useMemo, useState } from "react";
import {
  Box,
  Paper,
  Stack,
  Typography,
  Grid,
  Slider,
  Chip,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import useApi from "../hooks/useApi.js";
import {
  getOpportunityScore,
  getRatingVsHousing,
  getHighRatedWithHousing,
  getBusinessReviewStats,
} from "../api/client.js";
import LoadingState from "../components/LoadingState.jsx";
import ErrorState from "../components/ErrorState.jsx";

const formatUSD = (value) =>
  value == null
    ? "—"
    : Number(value).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });

const renderQ8Tooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <Paper sx={{ px: 1.5, py: 1, border: "1px solid #E4E9EE" }}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
        ZIP {point.postal_code}
        {point.city ? ` · ${point.city}` : ""}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        Avg business rating: {Number(point.rating).toFixed(2)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        Latest ZHVI: {formatUSD(point.zhvi)}
      </Typography>
    </Paper>
  );
};

/**
 * Neighborhood Analytics — complex queries:
 *   • Q11 /opportunity_score        — ranked leaderboard
 *   • Q8  /rating_vs_housing        — ZIP-level scatter plot
 *   • Q4  /high_rated_with_housing  — filterable detail table
 *   • Q5  /business_review_stats    — per-city top-N by reviews
 */
export default function NeighborhoodsPage() {
  // ---------------------------------------------------------------------------
  // Q11 — Opportunity Score Leaderboard
  // ---------------------------------------------------------------------------
  const [minBusinesses, setMinBusinesses] = useState(20);
  const {
    data: opportunityRows,
    loading: oppLoading,
    error: oppError,
    refetch: oppRefetch,
  } = useApi(
    () => getOpportunityScore({ min_businesses: minBusinesses }),
    [minBusinesses]
  );

  const opportunityGrid = useMemo(
    () =>
      (opportunityRows ?? []).slice(0, 200).map((row, idx) => ({
        id: `${row.postal_code}-${idx}`,
        postal_code: row.postal_code,
        city: row.city,
        business_count: Number(row.business_count),
        avg_business_stars: Number(row.avg_business_stars),
        avg_review_stars: Number(row.avg_review_stars),
        latest_zhvi: Number(row.latest_zhvi),
        zhvi_growth: Number(row.zhvi_growth),
      })),
    [opportunityRows]
  );

  const opportunityCols = [
    { field: "postal_code", headerName: "ZIP", width: 90 },
    { field: "city", headerName: "City", flex: 1, minWidth: 140 },
    {
      field: "business_count",
      headerName: "Businesses",
      type: "number",
      width: 110,
    },
    {
      field: "avg_review_stars",
      headerName: "Avg review ★",
      type: "number",
      width: 130,
      valueFormatter: (value) => (value == null ? "—" : value.toFixed(2)),
    },
    {
      field: "latest_zhvi",
      headerName: "Latest ZHVI",
      type: "number",
      width: 140,
      valueFormatter: (value) => formatUSD(value),
    },
    {
      field: "zhvi_growth",
      headerName: "ZHVI growth",
      type: "number",
      width: 140,
      valueFormatter: (value) => formatUSD(value),
    },
  ];

  // ---------------------------------------------------------------------------
  // Q8 — Rating vs Housing scatter
  // ---------------------------------------------------------------------------
  const [q8MinBusinesses, setQ8MinBusinesses] = useState(5);
  const {
    data: ratingHousingRows,
    loading: ratingLoading,
    error: ratingError,
    refetch: ratingRefetch,
  } = useApi(
    () => getRatingVsHousing({ min_businesses: q8MinBusinesses }),
    [q8MinBusinesses]
  );

  const scatterData = useMemo(
    () =>
      (ratingHousingRows ?? [])
        .filter((r) => r.avg_business_rating != null && r.latest_zhvi != null)
        .map((r) => ({
          postal_code: r.postal_code,
          city: r.city,
          rating: Number(r.avg_business_rating),
          zhvi: Number(r.latest_zhvi),
        })),
    [ratingHousingRows]
  );

  // ---------------------------------------------------------------------------
  // Q4 — High-rated businesses + housing
  // ---------------------------------------------------------------------------
  const [minReviews, setMinReviews] = useState(100);
  const [minRating, setMinRating] = useState(4.5);
  const {
    data: highRatedRows,
    loading: highLoading,
    error: highError,
    refetch: highRefetch,
  } = useApi(
    () =>
      getHighRatedWithHousing({
        min_reviews: minReviews,
        min_rating: minRating,
      }),
    [minReviews, minRating]
  );

  const highRatedGrid = useMemo(
    () =>
      (highRatedRows ?? []).slice(0, 200).map((row) => ({
        id: row.business_id,
        name: row.name,
        postal_code: row.postal_code,
        review_count: Number(row.review_count),
        avg_review_stars: Number(row.avg_review_stars),
        latest_zhvi: row.latest_zhvi == null ? null : Number(row.latest_zhvi),
      })),
    [highRatedRows]
  );

  const highRatedCols = [
    { field: "name", headerName: "Business", flex: 2, minWidth: 200 },
    { field: "postal_code", headerName: "ZIP", width: 90 },
    {
      field: "review_count",
      headerName: "Reviews",
      type: "number",
      width: 100,
    },
    {
      field: "avg_review_stars",
      headerName: "Avg review ★",
      type: "number",
      width: 130,
      valueFormatter: (value) => (value == null ? "—" : value.toFixed(2)),
    },
    {
      field: "latest_zhvi",
      headerName: "Latest ZHVI",
      type: "number",
      width: 140,
      valueFormatter: (value) => formatUSD(value),
    },
  ];

  // ---------------------------------------------------------------------------
  // Q5 — Per-city top-N most-reviewed businesses
  // ---------------------------------------------------------------------------
  const [topN, setTopN] = useState(5);
  const [reviewMin, setReviewMin] = useState(100);
  const {
    data: reviewStatsPayload,
    loading: reviewLoading,
    error: reviewError,
    refetch: reviewRefetch,
  } = useApi(
    () =>
      getBusinessReviewStats({
        top_n: topN,
        min_reviews: reviewMin,
        limit: 200,
      }),
    [topN, reviewMin]
  );

  const reviewStatsGrid = useMemo(
    () =>
      (reviewStatsPayload?.rows ?? []).map((row) => ({
        id: row.business_id,
        city_review_rank: Number(row.city_review_rank),
        city: row.city,
        name: row.name,
        postal_code: row.postal_code,
        total_reviews: Number(row.total_reviews),
        avg_review_rating: Number(row.avg_review_rating),
      })),
    [reviewStatsPayload]
  );

  const reviewStatsCols = [
    {
      field: "city_review_rank",
      headerName: "Rank in city",
      type: "number",
      width: 110,
    },
    { field: "city", headerName: "City", flex: 1, minWidth: 140 },
    { field: "name", headerName: "Business", flex: 2, minWidth: 200 },
    { field: "postal_code", headerName: "ZIP", width: 90 },
    {
      field: "total_reviews",
      headerName: "Reviews",
      type: "number",
      width: 100,
    },
    {
      field: "avg_review_rating",
      headerName: "Avg review ★",
      type: "number",
      width: 130,
      valueFormatter: (value) => (value == null ? "—" : value.toFixed(2)),
    },
  ];

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2">Neighborhood Analytics</Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 760 }}>
          Cross-reference Yelp business quality with Zillow housing prices to
          surface neighborhoods where business performance and home values
          rise together.
        </Typography>
      </Box>

      {/* SECTION 1 — Opportunity Score Leaderboard (Q11) ===================== */}
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ md: "flex-end" }}
          justifyContent="space-between"
          mb={2}
        >
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h3">Opportunity Score Leaderboard</Typography>
              <Chip size="small" label="Q11 ★" color="secondary" />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              ZIPs ranked by avg review rating, with housing growth context.
              Filtered to ZIPs that contain at least the configured number of
              businesses.
            </Typography>
          </Box>
          <Box sx={{ minWidth: 260 }}>
            <Typography variant="caption" color="text.secondary">
              Minimum businesses per ZIP: {minBusinesses}
            </Typography>
            <Slider
              value={minBusinesses}
              onChange={(_, v) => setMinBusinesses(v)}
              step={5}
              min={5}
              max={200}
              size="small"
              valueLabelDisplay="auto"
            />
          </Box>
        </Stack>

        {oppLoading && <LoadingState label="Computing opportunity scores…" />}
        {oppError && <ErrorState error={oppError} onRetry={oppRefetch} />}
        {!oppLoading && !oppError && (
          <Box sx={{ height: 460 }}>
            <DataGrid
              rows={opportunityGrid}
              columns={opportunityCols}
              disableRowSelectionOnClick
              initialState={{
                pagination: { paginationModel: { pageSize: 25 } },
                sorting: {
                  sortModel: [{ field: "avg_review_stars", sort: "desc" }],
                },
              }}
              pageSizeOptions={[10, 25, 50]}
              sx={{
                border: "none",
                "& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within": {
                  outline: "none",
                },
              }}
            />
          </Box>
        )}
      </Paper>

      {/* SECTION 2 — Rating vs ZHVI Scatter (Q8) ============================ */}
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ md: "flex-end" }}
          justifyContent="space-between"
          mb={2}
        >
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h3">Rating vs Housing Price</Typography>
              <Chip size="small" label="Q8 ★" color="secondary" />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Each dot is a ZIP. X-axis is the average business rating; Y-axis is
              the latest Zillow Home Value Index for that ZIP.
            </Typography>
          </Box>
          <Box sx={{ minWidth: 260 }}>
            <Typography variant="caption" color="text.secondary">
              Min businesses per ZIP: {q8MinBusinesses}
            </Typography>
            <Slider
              value={q8MinBusinesses}
              onChange={(_, v) => setQ8MinBusinesses(v)}
              step={1}
              min={1}
              max={100}
              size="small"
              valueLabelDisplay="auto"
            />
          </Box>
        </Stack>

        {ratingLoading && <LoadingState label="Loading scatter data…" />}
        {ratingError && (
          <ErrorState error={ratingError} onRetry={ratingRefetch} />
        )}
        {!ratingLoading && !ratingError && (
          <Box sx={{ height: 420 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 8, right: 24, bottom: 32, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E9EE" />
                <XAxis
                  type="number"
                  dataKey="rating"
                  name="Avg rating"
                  domain={[1, 5]}
                  ticks={[1, 2, 3, 4, 5]}
                  label={{
                    value: "Avg business rating",
                    position: "bottom",
                    offset: 8,
                  }}
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  type="number"
                  dataKey="zhvi"
                  name="Latest ZHVI"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) =>
                    v >= 1e6
                      ? `$${(v / 1e6).toFixed(1)}M`
                      : `$${(v / 1e3).toFixed(0)}K`
                  }
                />
                <ZAxis range={[40, 41]} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} content={renderQ8Tooltip} />
                <Scatter data={scatterData} fill="#1E4D6B" fillOpacity={0.55} />
              </ScatterChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Paper>

      {/* SECTION 3 — High-rated + Housing (Q4) ============================== */}
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ md: "flex-end" }}
          justifyContent="space-between"
          mb={2}
        >
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h3">High-Rated + Housing</Typography>
              <Chip size="small" label="Q4 ★" color="secondary" />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Businesses meeting both review-count and rating thresholds, with
              the latest ZHVI for their ZIP.
            </Typography>
          </Box>
          <Grid container spacing={2} sx={{ maxWidth: 360 }}>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary">
                Min reviews: {minReviews}
              </Typography>
              <Slider
                value={minReviews}
                onChange={(_, v) => setMinReviews(v)}
                step={25}
                min={25}
                max={500}
                size="small"
                valueLabelDisplay="auto"
              />
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary">
                Min rating: {minRating.toFixed(1)}
              </Typography>
              <Slider
                value={minRating}
                onChange={(_, v) => setMinRating(v)}
                step={0.1}
                min={3.0}
                max={5.0}
                size="small"
                valueLabelDisplay="auto"
              />
            </Grid>
          </Grid>
        </Stack>

        {highLoading && <LoadingState label="Loading qualifying businesses…" />}
        {highError && <ErrorState error={highError} onRetry={highRefetch} />}
        {!highLoading && !highError && (
          <Box sx={{ height: 460 }}>
            <DataGrid
              rows={highRatedGrid}
              columns={highRatedCols}
              disableRowSelectionOnClick
              initialState={{
                pagination: { paginationModel: { pageSize: 25 } },
                sorting: {
                  sortModel: [{ field: "avg_review_stars", sort: "desc" }],
                },
              }}
              pageSizeOptions={[10, 25, 50]}
              sx={{
                border: "none",
                "& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within": {
                  outline: "none",
                },
              }}
            />
          </Box>
        )}
      </Paper>

      {/* SECTION 4 — Top Businesses per City (Q5) =========================== */}
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ md: "flex-end" }}
          justifyContent="space-between"
          mb={2}
        >
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h3">Top Businesses per City</Typography>
              <Chip size="small" label="Q5 ★" color="secondary" />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              The most-reviewed businesses in each city, ranked using a CTE
              with{" "}
              <code>RANK() OVER (PARTITION BY city ORDER BY total_reviews DESC)</code>
              {" "}joined across business × review × zip_region with a HAVING
              filter on the review count.
            </Typography>
          </Box>
          <Grid container spacing={2} sx={{ maxWidth: 360 }}>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary">
                Top N per city: {topN}
              </Typography>
              <Slider
                value={topN}
                onChange={(_, v) => setTopN(v)}
                step={1}
                min={1}
                max={10}
                size="small"
                valueLabelDisplay="auto"
              />
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary">
                Min reviews: {reviewMin}
              </Typography>
              <Slider
                value={reviewMin}
                onChange={(_, v) => setReviewMin(v)}
                step={25}
                min={25}
                max={500}
                size="small"
                valueLabelDisplay="auto"
              />
            </Grid>
          </Grid>
        </Stack>

        {reviewLoading && <LoadingState label="Computing per-city ranks…" />}
        {reviewError && (
          <ErrorState error={reviewError} onRetry={reviewRefetch} />
        )}
        {!reviewLoading && !reviewError && (
          <Box sx={{ height: 460 }}>
            <DataGrid
              rows={reviewStatsGrid}
              columns={reviewStatsCols}
              disableRowSelectionOnClick
              initialState={{
                pagination: { paginationModel: { pageSize: 25 } },
                sorting: {
                  sortModel: [
                    { field: "city", sort: "asc" },
                    { field: "city_review_rank", sort: "asc" },
                  ],
                },
              }}
              pageSizeOptions={[10, 25, 50]}
              sx={{
                border: "none",
                "& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within": {
                  outline: "none",
                },
              }}
            />
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
