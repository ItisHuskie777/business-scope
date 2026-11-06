import { useMemo } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  createFilterOptions,
} from "@mui/material";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSearchParams } from "react-router-dom";
import useApi from "../hooks/useApi.js";
import { compareZips, getHousingTrend, getZipCodes } from "../api/client.js";
import { MAX_COMPARE, formatZipList, mergeSeries, parseZipList } from "../utils/zipList.js";
import LoadingState from "../components/LoadingState.jsx";
import ErrorState from "../components/ErrorState.jsx";

const COLORS = ["#2A9D8F", "#E76F51", "#264653", "#E9C46A"];

const usd = (value) =>
  value == null
    ? "—"
    : Number(value).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const number = (value, digits = 0) =>
  value == null ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const percent = (value) => (value == null ? "—" : `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(1)}%`);

// One row of the comparison table per metric.
const METRICS = [
  { label: "City", value: (z) => [z.city, z.state].filter(Boolean).join(", ") || "—" },
  { label: "Businesses", value: (z) => number(z.business_count) },
  { label: "Open now", value: (z) => (z.business_count ? `${number(z.open_count)} (${Math.round((100 * z.open_count) / z.business_count)}%)` : "—") },
  { label: "Average Yelp stars", value: (z) => number(z.avg_business_stars, 2) },
  { label: "Reviews", value: (z) => number(z.total_reviews) },
  { label: "Average review stars", value: (z) => number(z.avg_review_stars, 2) },
  { label: "Home value (latest)", value: (z) => usd(z.latest_zhvi) },
  { label: "Change over the year", value: (z) => percent(z.zhvi_change_pct) },
];

// Thousands of ZIPs exist; show the first matches instead of rendering all of them.
const filterZips = createFilterOptions({ limit: 50 });

/**
 * Side-by-side comparison of 2–4 ZIP codes. The selection lives in the URL
 * (?zips=19104,19103), so a comparison can be bookmarked or shared.
 */
export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const zips = parseZipList(params.get("zips"));
  const zipKey = formatZipList(zips);
  const setZips = (next) => setParams(next.length ? { zips: formatZipList(next) } : {}, { replace: true });

  const { data: zipOptions } = useApi(() => getZipCodes(), []);
  const labels = useMemo(
    () => Object.fromEntries((zipOptions ?? []).map((z) => [z.postal_code, `${z.postal_code} · ${z.city}, ${z.state}`])),
    [zipOptions]
  );

  const ready = zips.length >= 2;
  const { data, loading, error, refetch } = useApi(
    () => (ready ? compareZips(zips) : Promise.resolve(null)),
    [zipKey]
  );
  const { data: housing } = useApi(
    () => (ready ? Promise.all(zips.map((z) => getHousingTrend(z))) : Promise.resolve(null)),
    [zipKey]
  );
  const chartData = useMemo(() => (housing ? mergeSeries(zips, housing) : []), [housing, zipKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const profiles = data?.zips ?? [];
  const missing = profiles.filter((z) => !z.found).map((z) => z.postal_code);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h2">Compare neighborhoods</Typography>
        <Typography color="text.secondary">
          Pick 2 to {MAX_COMPARE} ZIP codes to see their businesses, ratings and home values side by side.
        </Typography>
      </Box>

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Autocomplete
          multiple
          options={(zipOptions ?? []).map((z) => z.postal_code)}
          filterOptions={filterZips}
          getOptionLabel={(zip) => labels[zip] || zip}
          getOptionDisabled={() => zips.length >= MAX_COMPARE}
          value={zips}
          onChange={(_, next) => setZips(next.slice(0, MAX_COMPARE))}
          renderTags={(value, getTagProps) =>
            value.map((zip, index) => {
              const { key, ...rest } = getTagProps({ index });
              return <Chip key={key} label={zip} {...rest} sx={{ bgcolor: COLORS[index], color: "#fff" }} />;
            })
          }
          renderInput={(p) => (
            <TextField {...p} label="ZIP codes" placeholder={zips.length >= MAX_COMPARE ? "" : "Add a ZIP"} />
          )}
        />
      </Paper>

      {!ready && (
        <Typography color="text.secondary">Choose at least two ZIP codes to compare.</Typography>
      )}
      {ready && loading && <LoadingState label="Comparing…" />}
      {ready && error && <ErrorState error={error} onRetry={refetch} />}

      {ready && !loading && !error && profiles.length > 0 && (
        <>
          {missing.length > 0 && (
            <Alert severity="info">No data for {missing.join(", ")}.</Alert>
          )}

          <Paper sx={{ overflow: "hidden" }}>
            <TableContainer>
              <Table size="small" aria-label="ZIP comparison">
                <TableHead>
                  <TableRow>
                    <TableCell />
                    {profiles.map((z, i) => (
                      <TableCell key={z.postal_code} sx={{ fontWeight: 700, color: COLORS[i] }}>
                        {z.postal_code}
                        {z.region_name ? (
                          <Typography variant="caption" display="block" color="text.secondary">
                            {z.region_name}
                          </Typography>
                        ) : null}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {METRICS.map((metric) => (
                    <TableRow key={metric.label}>
                      <TableCell component="th" scope="row" sx={{ color: "text.secondary" }}>
                        {metric.label}
                      </TableCell>
                      {profiles.map((z) => (
                        <TableCell key={z.postal_code}>{z.found ? metric.value(z) : "—"}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell component="th" scope="row" sx={{ color: "text.secondary", verticalAlign: "top" }}>
                      Top categories
                    </TableCell>
                    {profiles.map((z) => (
                      <TableCell key={z.postal_code}>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          {z.top_categories.map((c) => (
                            <Chip key={c.category} size="small" variant="outlined" label={`${c.category} · ${c.business_count}`} />
                          ))}
                          {z.top_categories.length === 0 && "—"}
                        </Box>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h3" gutterBottom>
              Home values
            </Typography>
            {chartData.length === 0 ? (
              <Typography color="text.secondary">No home value data for these ZIP codes.</Typography>
            ) : (
              <Box sx={{ height: 320 }} data-testid="compare-chart">
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E9EE" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1e3).toFixed(0)}K`} />
                    <Tooltip formatter={(value, name) => [usd(value), name]} />
                    <Legend />
                    {zips.map((zip, i) => (
                      <Line key={zip} type="monotone" dataKey={zip} stroke={COLORS[i]} strokeWidth={2} dot={false} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Paper>
        </>
      )}
    </Stack>
  );
}

