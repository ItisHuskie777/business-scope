import { useMemo, useState } from "react";
import {
  Box,
  Paper,
  Stack,
  Typography,
  Autocomplete,
  TextField,
  Slider,
  Switch,
  FormControlLabel,
  Chip,
  Grid,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import { useNavigate } from "react-router-dom";
import useApi from "../hooks/useApi.js";
import {
  getBusinesses,
  getCities,
  getZipCodes,
} from "../api/client.js";
import LoadingState from "../components/LoadingState.jsx";
import ErrorState from "../components/ErrorState.jsx";
import StarRating from "../components/StarRating.jsx";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

/**
 * Business Explorer — owned by Colin.
 * Filters drive the parameterised /businesses endpoint so the table reflects
 * the entire 145K-business dataset, not just one ZIP.
 */
export default function BusinessExplorerPage() {
  const navigate = useNavigate();

  const [stateCode, setStateCode] = useState("PA");
  const [city, setCity] = useState("Philadelphia");
  const [zip, setZip] = useState("");
  const [minStars, setMinStars] = useState(0);
  const [openOnly, setOpenOnly] = useState(true);

  const { data: citiesData } = useApi(
    () => getCities(stateCode || undefined),
    [stateCode]
  );
  const { data: zipsData } = useApi(
    () => getZipCodes(city || undefined),
    [city]
  );
  const cities = citiesData ?? [];
  const zips = zipsData ?? [];

  const {
    data: businessesPayload,
    loading,
    error,
    refetch,
  } = useApi(
    () =>
      getBusinesses({
        state: stateCode || undefined,
        city: city || undefined,
        postal_code: zip || undefined,
        min_stars: minStars > 0 ? minStars : undefined,
        open_only: openOnly,
        limit: 500,
      }),
    [stateCode, city, zip, minStars, openOnly]
  );

  const rows = useMemo(() => {
    const list = businessesPayload?.rows ?? [];
    return list.map((b) => ({
      id: b.business_id,
      name: b.name,
      city: b.city,
      state: b.state,
      postal_code: b.postal_code,
      stars: Number(b.stars),
      categories: b.categories || "",
    }));
  }, [businessesPayload]);

  const columns = [
    { field: "name", headerName: "Business", flex: 2, minWidth: 200 },
    { field: "city", headerName: "City", flex: 1, minWidth: 120 },
    { field: "state", headerName: "State", width: 80 },
    { field: "postal_code", headerName: "ZIP", width: 90 },
    {
      field: "stars",
      headerName: "Rating",
      flex: 1,
      minWidth: 160,
      renderCell: (params) => <StarRating value={params.value} />,
    },
    {
      field: "categories",
      headerName: "Categories",
      flex: 3,
      minWidth: 240,
      renderCell: (params) => (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {params.value || "—"}
        </Typography>
      ),
    },
  ];

  const cityOptions = cities.map((c) => c.city);
  const zipOptions = zips.map((z) => z.postal_code);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h2">Business Explorer</Typography>
        <Typography color="text.secondary">
          Search the full 145K-business Yelp dataset by state, city, ZIP and
          rating. Click any row to open the detail page.
        </Typography>
      </Box>

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={2}>
            <Autocomplete
              options={US_STATES}
              value={stateCode || null}
              onChange={(_, v) => {
                setStateCode(v || "");
                setCity("");
                setZip("");
              }}
              renderInput={(params) => (
                <TextField {...params} label="State" size="small" />
              )}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Autocomplete
              options={cityOptions}
              value={city || null}
              onChange={(_, v) => {
                setCity(v || "");
                setZip("");
              }}
              renderInput={(params) => (
                <TextField {...params} label="City" size="small" />
              )}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <Autocomplete
              options={zipOptions}
              value={zip || null}
              onChange={(_, v) => setZip(v || "")}
              renderInput={(params) => (
                <TextField {...params} label="ZIP" size="small" />
              )}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Box sx={{ px: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Minimum stars: {minStars.toFixed(1)}
              </Typography>
              <Slider
                value={minStars}
                onChange={(_, v) => setMinStars(v)}
                step={0.5}
                marks
                min={0}
                max={5}
                size="small"
              />
            </Box>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={openOnly}
                  onChange={(e) => setOpenOnly(e.target.checked)}
                />
              }
              label="Open only"
            />
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 0, overflow: "hidden" }}>
        <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h5">Results</Typography>
          <Chip
            size="small"
            label={`${rows.length} business${rows.length === 1 ? "" : "es"}`}
            color="primary"
            variant="outlined"
          />
          <Typography variant="caption" color="text.secondary">
            (capped at 500 per page)
          </Typography>
        </Box>

        {loading && <LoadingState label="Fetching businesses…" />}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {!loading && !error && (
          <Box sx={{ height: 560 }}>
            <DataGrid
              rows={rows}
              columns={columns}
              disableRowSelectionOnClick
              onRowClick={(params) => navigate(`/business/${params.id}`)}
              initialState={{
                pagination: { paginationModel: { pageSize: 25 } },
              }}
              pageSizeOptions={[10, 25, 50, 100]}
              sx={{
                border: "none",
                "& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within": {
                  outline: "none",
                },
                "& .MuiDataGrid-row": { cursor: "pointer" },
              }}
            />
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
