import { useParams, Link } from "react-router-dom";
import {
  Box,
  Paper,
  Stack,
  Typography,
  Chip,
  Button,
  Divider,
  Grid,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import useApi from "../hooks/useApi.js";
import { getBusinessById, getHousingTrend } from "../api/client.js";
import { isValidZip } from "../utils/validation.js";
import LoadingState from "../components/LoadingState.jsx";
import ErrorState from "../components/ErrorState.jsx";
import StarRating from "../components/StarRating.jsx";

function parseCategories(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function parseHours(raw) {
  if (!raw) return null;
  try {
    // The backend stores hours as a Python-style stringified dict in some rows.
    // Accept JSON or fall back to showing the raw string safely.
    const jsonish = raw.replace(/'/g, '"');
    return JSON.parse(jsonish);
  } catch {
    return null;
  }
}

export default function BusinessDetailPage() {
  const { id } = useParams();
  const {
    data: business,
    loading,
    error,
    refetch,
  } = useApi(() => getBusinessById(id), [id]);

  const zip = business?.postal_code;
  const { data: housing } = useApi(
    () => (isValidZip(zip) ? getHousingTrend(zip) : Promise.resolve([])),
    [zip]
  );

  if (loading) return <LoadingState label="Loading business…" height={400} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!business) return null;

  const categories = parseCategories(business.categories);
  const hours = parseHours(business.hours);
  const trend = (housing || []).map((r) => ({
    date: r.trend_date?.slice(0, 10),
    zhvi: r.zhvi_value == null ? null : Number(r.zhvi_value),
  }));

  return (
    <Stack spacing={3}>
      <Button
        component={Link}
        to="/businesses"
        startIcon={<ArrowBackIcon />}
        sx={{ alignSelf: "flex-start" }}
      >
        Back to Explorer
      </Button>

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ md: "flex-end" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="h2">{business.name}</Typography>
            <Typography color="text.secondary">
              {[business.address, business.city, business.state, business.postal_code]
                .filter(Boolean)
                .join(", ") || "Address unavailable"}
            </Typography>
          </Box>
          <Stack direction="row" spacing={2} alignItems="center">
            <StarRating value={business.stars} />
            <Chip
              size="small"
              label={business.is_open ? "Open" : "Closed"}
              color={business.is_open ? "success" : "default"}
            />
          </Stack>
        </Stack>

        <Divider sx={{ my: 3 }} />

        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Typography variant="overline" color="text.secondary">
              Total reviews
            </Typography>
            <Typography variant="h3">
              {Number(business.total_reviews || 0).toLocaleString()}
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="overline" color="text.secondary">
              Avg review rating
            </Typography>
            <Typography variant="h3">
              {business.avg_review_stars
                ? Number(business.avg_review_stars).toFixed(2)
                : "—"}
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="overline" color="text.secondary">
              Business ID
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
            >
              {business.business_id}
            </Typography>
          </Grid>
        </Grid>

        {categories.length > 0 && (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="overline" color="text.secondary">
              Categories
            </Typography>
            <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {categories.map((c) => (
                <Chip key={c} label={c} size="small" variant="outlined" />
              ))}
            </Box>
          </>
        )}

        {hours && (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="overline" color="text.secondary">
              Hours
            </Typography>
            <Grid container spacing={1} sx={{ mt: 0.5 }}>
              {Object.entries(hours).map(([day, span]) => (
                <Grid key={day} item xs={6} sm={4} md={3}>
                  <Typography variant="body2">
                    <strong>{day}</strong>: {span}
                  </Typography>
                </Grid>
              ))}
            </Grid>
          </>
        )}
      </Paper>

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack direction="row" spacing={1} alignItems="baseline" mb={1}>
          <Typography variant="h3">Housing trend</Typography>
          <Typography variant="body2" color="text.secondary">
            ZHVI history for ZIP {zip || "—"}
          </Typography>
        </Stack>
        {!isValidZip(zip) ? (
          <Typography color="text.secondary">
            No valid ZIP on this business — housing trend unavailable.
          </Typography>
        ) : trend.length === 0 ? (
          <Typography color="text.secondary">
            No ZHVI data for this ZIP.
          </Typography>
        ) : (
          <Box sx={{ height: 300 }}>
            <ResponsiveContainer>
              <LineChart
                data={trend}
                margin={{ top: 8, right: 24, left: 0, bottom: 16 }}
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
                <Tooltip
                  formatter={(value) => [
                    Number(value).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    }),
                    "ZHVI",
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="zhvi"
                  stroke="#E76F51"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
