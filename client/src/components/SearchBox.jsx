import { useEffect, useState } from "react";
import { Autocomplete, Box, InputAdornment, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useNavigate } from "react-router-dom";
import { searchBusinesses } from "../api/client.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";

const MIN_CHARS = 2;

/**
 * Business search in the navigation bar. Queries /search once typing pauses,
 * cancels a request that a newer one has made obsolete, and opens the detail
 * page of the chosen business.
 */
export default function SearchBox() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const query = useDebouncedValue(input.trim(), 250);

  useEffect(() => {
    if (query.length < MIN_CHARS) {
      setOptions([]);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    searchBusinesses(query, { limit: 8, signal: controller.signal })
      .then((data) => setOptions(data.rows))
      .catch(() => {
        // A cancelled request is expected and says nothing about the server.
        if (!controller.signal.aborted) {
          setOptions([]);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  const noOptionsText =
    input.trim().length < MIN_CHARS
      ? "Type at least 2 characters"
      : failed
      ? "Search is unavailable right now"
      : "No matching businesses";

  return (
    <Autocomplete
      sx={{ width: { xs: 180, sm: 260, md: 320 } }}
      size="small"
      options={options}
      loading={loading}
      // The server already filtered and ranked the results.
      filterOptions={(x) => x}
      getOptionLabel={(option) => option.name}
      isOptionEqualToValue={(a, b) => a.business_id === b.business_id}
      inputValue={input}
      onInputChange={(_, value, reason) => {
        if (reason !== "reset") setInput(value);
      }}
      onChange={(_, option) => {
        if (option) {
          setInput("");
          setOptions([]);
          navigate(`/business/${option.business_id}`);
        }
      }}
      value={null}
      blurOnSelect
      noOptionsText={noOptionsText}
      renderOption={(props, option) => {
        const { key, ...rest } = props;
        return (
          <Box component="li" key={key} {...rest}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {option.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {[option.city, option.state].filter(Boolean).join(", ")}
                {option.categories ? ` · ${option.categories}` : ""}
              </Typography>
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Search businesses"
          inputProps={{ ...params.inputProps, "aria-label": "Search businesses" }}
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{
            "& .MuiOutlinedInput-root": {
              bgcolor: "rgba(255,255,255,0.95)",
              borderRadius: 2,
            },
          }}
        />
      )}
    />
  );
}
