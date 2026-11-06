import {
  Box,
  Typography,
  Grid,
  Card,
  CardActionArea,
  CardContent,
  Paper,
  Stack,
  Chip,
} from "@mui/material";
import StorefrontIcon from "@mui/icons-material/Storefront";
import LocationCityIcon from "@mui/icons-material/LocationCity";
import MapIcon from "@mui/icons-material/Map";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import { Link } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import useApi from "../hooks/useApi.js";
import { getCategories, getCityBusinessStats } from "../api/client.js";
import LoadingState from "../components/LoadingState.jsx";
import ErrorState from "../components/ErrorState.jsx";

const FEATURES = [
  {
    to: "/businesses",
    title: "Business Explorer",
    description:
      "Browse Yelp businesses by city and ZIP with rating and review filters.",
    icon: <StorefrontIcon fontSize="large" />,
  },
  {
    to: "/neighborhoods",
    title: "Neighborhood Analytics",
    description:
      "Compare business quality and housing prices across neighborhoods.",
    icon: <LocationCityIcon fontSize="large" />,
  },
  {
    to: "/compare",
    title: "Compare Neighborhoods",
    description:
      "Put up to four ZIP codes side by side: businesses, ratings, home values and top categories.",
    icon: <CompareArrowsIcon fontSize="large" />,
  },
  {
    to: "/map",
    title: "Map & Recommendations",
    description:
      "Visualize opportunity scores on a map and discover promising ZIPs.",
    icon: <MapIcon fontSize="large" />,
  },
];

export default function HomePage() {
  const { data, loading, error, refetch } = useApi(getCityBusinessStats, []);
  const categories = useApi(() => getCategories({ limit: 10 }), []);
  const topCategories = (categories.data || []).map((row) => ({
    category: row.category,
    businesses: row.business_count,
    stars: Number(row.avg_stars),
  }));

  const top = (data || []).slice(0, 10).map((row) => ({
    city: row.city,
    businesses: Number(row.num_businesses),
  }));

  return (
    <Stack spacing={4}>
      <Box>
        <Chip
          label="CIS 5500 · Group 35"
          size="small"
          color="secondary"
          sx={{ mb: 1.5 }}
        />
        <Typography variant="h1" gutterBottom>
          Business Scope
        </Typography>
        <Typography variant="h5" color="text.secondary" sx={{ maxWidth: 780 }}>
          Combine Yelp business data with Zillow housing trends to identify
          neighborhoods where businesses thrive and property values are
          climbing.
        </Typography>
      </Box>

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack direction="row" spacing={1} alignItems="baseline" mb={1}>
          <Typography variant="h3">Top cities by business count</Typography>
          <Typography variant="body2" color="text.secondary">
            live from /city_business_stats
          </Typography>
        </Stack>
        {loading && <LoadingState label="Fetching city statistics…" />}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {!loading && !error && (
          <Box sx={{ width: "100%", height: 340 }}>
            <ResponsiveContainer>
              <BarChart
                data={top}
                margin={{ top: 8, right: 24, left: 0, bottom: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E9EE" />
                <XAxis
                  dataKey="city"
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                  tick={{ fontSize: 12 }}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value) => [
                    value.toLocaleString(),
                    "Businesses",
                  ]}
                />
                <Bar
                  dataKey="businesses"
                  fill="#1E4D6B"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Paper>

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack direction="row" spacing={1} alignItems="baseline" mb={1}>
          <Typography variant="h3">Most common categories</Typography>
          <Typography variant="body2" color="text.secondary">
            live from /categories
          </Typography>
        </Stack>
        {categories.loading && <LoadingState label="Fetching categories…" />}
        {categories.error && <ErrorState error={categories.error} onRetry={categories.refetch} />}
        {!categories.loading && !categories.error && (
          <Box sx={{ width: "100%", height: 360 }} data-testid="category-chart">
            <ResponsiveContainer>
              <BarChart data={topCategories} layout="vertical" margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E9EE" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="category" width={140} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value, _name, item) => [
                    `${value.toLocaleString()} businesses, ${item.payload.stars.toFixed(2)}★ average`,
                    item.payload.category,
                  ]}
                />
                <Bar dataKey="businesses" fill="#2A9D8F" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Paper>

      <Box>
        <Typography variant="h3" gutterBottom>
          Features
        </Typography>
        <Grid container spacing={2}>
          {FEATURES.map((f) => (
            <Grid key={f.to} item xs={12} sm={6} md={3}>
              <Card sx={{ height: "100%" }}>
                <CardActionArea component={Link} to={f.to} sx={{ height: "100%" }}>
                  <CardContent sx={{ p: 3 }}>
                    <Box sx={{ color: "primary.main", mb: 1 }}>{f.icon}</Box>
                    <Typography variant="h4" gutterBottom>
                      {f.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {f.description}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
    </Stack>
  );
}
