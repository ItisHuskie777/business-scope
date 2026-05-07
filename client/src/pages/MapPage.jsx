import { useMemo, useState } from "react";
import {
  Box,
  Paper,
  Stack,
  Typography,
  Chip,
  Slider,
  TextField,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import useApi from "../hooks/useApi.js";
import {
  getCityBusinessStats,
  getTopBusinessPerZip,
  getHousingTrend,
} from "../api/client.js";
import { lookupCity } from "../data/cityCoords.js";
import { isValidZip } from "../utils/validation.js";
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

/**
 * Map & Recommendation page.
 *
 * Surfaces:
 *   • /city_business_stats  — used to size + colour bubbles on the map
 *   • Q6 /top_business_per_zip ★ — sortable table beside the map
 *   • Q7 /housing_trend/:zip      — line chart for the chosen ZIP
 */
export default function MapPage() {
  // ---- City bubble map ----------------------------------------------------
  const {
    data: cityStats,
    loading: cityLoading,
    error: cityError,
    refetch: cityRefetch,
  } = useApi(getCityBusinessStats, []);

  const bubbles = useMemo(() => {
    return (cityStats ?? [])
      .map((row) => {
        const coords = lookupCity(row.city);
        if (!coords) return null;
        return {
          city: row.city,
          state: coords.state,
          lat: coords.lat,
          lng: coords.lng,
          businesses: Number(row.num_businesses),
        };
      })
      .filter(Boolean);
  }, [cityStats]);

  const maxBusinesses = useMemo(
    () => bubbles.reduce((m, b) => Math.max(m, b.businesses), 0) || 1,
    [bubbles]
  );
  const radiusFor = (count) => 6 + Math.sqrt(count / maxBusinesses) * 28;

  // ---- Q6 table: top business per ZIP -------------------------------------
  const [topLimit, setTopLimit] = useState(50);
  const {
    data: topRows,
    loading: topLoading,
    error: topError,
    refetch: topRefetch,
  } = useApi(() => getTopBusinessPerZip({ limit: topLimit }), [topLimit]);

  const topGrid = useMemo(
    () =>
      (topRows ?? []).map((row, idx) => ({
        id: `${row.postal_code}-${idx}`,
        postal_code: row.postal_code,
        name: row.name,
        review_count: Number(row.review_count),
      })),
    [topRows]
  );

  const topCols = [
    { field: "postal_code", headerName: "ZIP", width: 90 },
    { field: "name", headerName: "Top business", flex: 2, minWidth: 180 },
    {
      field: "review_count",
      headerName: "Reviews",
      type: "number",
      width: 110,
    },
  ];

  // ---- Q7 housing trend ---------------------------------------------------
  const [selectedZip, setSelectedZip] = useState("19104");
  const [zipInput, setZipInput] = useState("19104");
  const {
    data: housingRows,
    loading: housingLoading,
    error: housingError,
  } = useApi(
    () =>
      isValidZip(selectedZip)
        ? getHousingTrend(selectedZip)
        : Promise.resolve([]),
    [selectedZip]
  );

  const housingSeries = useMemo(
    () =>
      (housingRows ?? []).map((r) => ({
        date: r.trend_date?.slice(0, 10),
        zhvi: r.zhvi_value == null ? null : Number(r.zhvi_value),
      })),
    [housingRows]
  );

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h2">Map &amp; Recommendations</Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 760 }}>
          Visualize where Yelp coverage is densest, drill into the top
          business per ZIP, and inspect housing-price trajectories.
        </Typography>
      </Box>

      {/* ===== City bubble map ============================================== */}
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack direction="row" spacing={1} alignItems="baseline" mb={1}>
          <Typography variant="h3">Business density by city</Typography>
          <Typography variant="body2" color="text.secondary">
            bubble size = business count
          </Typography>
        </Stack>
        {cityLoading && <LoadingState label="Loading city stats…" />}
        {cityError && <ErrorState error={cityError} onRetry={cityRefetch} />}
        {!cityLoading && !cityError && (
          <Box sx={{ height: 460, borderRadius: 2, overflow: "hidden" }}>
            <MapContainer
              center={[37.5, -96]}
              zoom={4}
              scrollWheelZoom
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {bubbles.map((b) => (
                <CircleMarker
                  key={`${b.city}-${b.state}`}
                  center={[b.lat, b.lng]}
                  radius={radiusFor(b.businesses)}
                  pathOptions={{
                    color: "#E76F51",
                    fillColor: "#E76F51",
                    fillOpacity: 0.55,
                    weight: 1,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -6]}>
                    <strong>{b.city}, {b.state}</strong>
                    <br />
                    {b.businesses.toLocaleString()} businesses
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </Box>
        )}
      </Paper>

      {/* ===== Q6 table + Q7 chart ========================================= */}
      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        }}
      >
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={1}>
            <Typography variant="h3">Top Business per ZIP</Typography>
            <Chip size="small" label="Q6 ★" color="secondary" />
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Single most-reviewed business in each ZIP, ranked by review count
            using <code>RANK() OVER (PARTITION BY postal_code …)</code>.
          </Typography>
          <Box sx={{ mb: 2, maxWidth: 320 }}>
            <Typography variant="caption" color="text.secondary">
              Rows: {topLimit}
            </Typography>
            <Slider
              value={topLimit}
              onChange={(_, v) => setTopLimit(v)}
              step={10}
              min={10}
              max={500}
              size="small"
              valueLabelDisplay="auto"
            />
          </Box>
          {topLoading && <LoadingState label="Loading top businesses…" />}
          {topError && <ErrorState error={topError} onRetry={topRefetch} />}
          {!topLoading && !topError && (
            <Box sx={{ height: 420 }}>
              <DataGrid
                rows={topGrid}
                columns={topCols}
                disableRowSelectionOnClick
                onRowClick={(p) => {
                  const newZip = p.row.postal_code;
                  setZipInput(newZip);
                  if (isValidZip(newZip)) setSelectedZip(newZip);
                }}
                initialState={{
                  pagination: { paginationModel: { pageSize: 25 } },
                }}
                pageSizeOptions={[10, 25, 50]}
                sx={{
                  border: "none",
                  "& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within":
                    { outline: "none" },
                  "& .MuiDataGrid-row": { cursor: "pointer" },
                }}
              />
            </Box>
          )}
        </Paper>

        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={1}>
            <Typography variant="h3">Housing Trend</Typography>
            <Chip size="small" label="Q7" />
          </Stack>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Zillow Home Value Index over time for one ZIP. Click a row in the
            left table to switch ZIPs, or type one below.
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <TextField
              size="small"
              label="ZIP"
              value={zipInput}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d]/g, "").slice(0, 5);
                setZipInput(v);
                if (isValidZip(v)) setSelectedZip(v);
              }}
              sx={{ width: 120 }}
            />
            <Typography variant="caption" color="text.secondary">
              Showing {selectedZip}
              {!isValidZip(zipInput) && " — enter 5 digits to update"}
            </Typography>
          </Stack>
          {housingLoading && <LoadingState label="Loading ZHVI…" />}
          {housingError && <ErrorState error={housingError} />}
          {!housingLoading && !housingError && (
            <Box sx={{ height: 360 }}>
              {housingSeries.length === 0 ? (
                <Typography color="text.secondary">
                  No ZHVI data for {selectedZip}.
                </Typography>
              ) : (
                <ResponsiveContainer>
                  <LineChart
                    data={housingSeries}
                    margin={{ top: 8, right: 24, bottom: 16, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E9EE" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      minTickGap={40}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) =>
                        v >= 1e6
                          ? `$${(v / 1e6).toFixed(1)}M`
                          : `$${(v / 1e3).toFixed(0)}K`
                      }
                    />
                    <RechartsTooltip
                      formatter={(value) => [formatUSD(value), "ZHVI"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="zhvi"
                      stroke="#1E4D6B"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Box>
          )}
        </Paper>
      </Box>
    </Stack>
  );
}
