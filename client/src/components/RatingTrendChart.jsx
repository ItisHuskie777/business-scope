import { Box, Typography } from "@mui/material";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useApi from "../hooks/useApi.js";
import { getRatingTrend } from "../api/client.js";
import LoadingState from "./LoadingState.jsx";
import ErrorState from "./ErrorState.jsx";

/**
 * Average stars per month (line, left axis) over the number of reviews that
 * month (bars, right axis), so a dip can be read against how many reviews
 * produced it.
 */
export default function RatingTrendChart({ businessId }) {
  const { data, loading, error, refetch } = useApi(() => getRatingTrend(businessId), [businessId]);

  if (loading) return <LoadingState label="Loading rating trend…" height={240} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data || data.length === 0) {
    return <Typography color="text.secondary">No dated reviews to chart.</Typography>;
  }

  const points = data.map((row) => ({
    month: row.month.slice(0, 7),
    avg: Number(row.avg_stars),
    count: row.review_count,
  }));

  return (
    <Box sx={{ height: 280 }} data-testid="rating-trend">
      <ResponsiveContainer>
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E4E9EE" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={30} />
          <YAxis yAxisId="stars" domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} width={30} />
          <YAxis yAxisId="count" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
          <Tooltip
            formatter={(value, name) =>
              name === "avg" ? [Number(value).toFixed(2), "Average stars"] : [value, "Reviews"]
            }
          />
          <Bar yAxisId="count" dataKey="count" fill="#CFE3EA" />
          <Line yAxisId="stars" type="monotone" dataKey="avg" stroke="#2A9D8F" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Box>
  );
}
