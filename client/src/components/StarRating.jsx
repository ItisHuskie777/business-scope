import Rating from "@mui/material/Rating";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/**
 * Compact read-only star display with an optional numeric label.
 * Tolerates null/undefined/string inputs so it can be dropped directly
 * into table cells.
 */
export default function StarRating({
  value,
  precision = 0.5,
  size = "small",
  showNumber = true,
}) {
  const numeric = value == null ? 0 : Number(value);
  const safe = Number.isNaN(numeric) ? 0 : numeric;

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      <Rating
        value={safe}
        precision={precision}
        size={size}
        readOnly
      />
      {showNumber && (
        <Typography variant="body2" color="text.secondary">
          {safe.toFixed(1)}
        </Typography>
      )}
    </Box>
  );
}
