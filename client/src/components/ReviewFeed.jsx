import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Divider,
  Rating,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { getBusinessReviews } from "../api/client.js";
import LoadingState from "./LoadingState.jsx";
import ErrorState from "./ErrorState.jsx";

const PAGE_SIZE = 10;

const formatDate = (value) =>
  value
    ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Undated";

/**
 * Newest reviews of one business with a star filter and "Load more". Pages
 * come from /business/:id/reviews; each request passes the cursor returned
 * by the previous one.
 */
export default function ReviewFeed({ businessId }) {
  const [stars, setStars] = useState(null);
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped whenever the business or filter changes, so a slow response for the
  // old selection cannot be appended to the new list.
  const generation = useRef(0);

  const load = useCallback(
    (fromCursor) => {
      const mine = generation.current;
      setLoading(true);
      setError(null);
      getBusinessReviews(businessId, {
        cursor: fromCursor || undefined,
        stars: stars || undefined,
        limit: PAGE_SIZE,
      })
        .then((page) => {
          if (mine !== generation.current) return;
          setRows((prev) => (fromCursor ? [...prev, ...page.rows] : page.rows));
          setCursor(page.next_cursor);
        })
        .catch((err) => {
          if (mine === generation.current) setError(err);
        })
        .finally(() => {
          if (mine === generation.current) setLoading(false);
        });
    },
    [businessId, stars]
  );

  useEffect(() => {
    generation.current += 1;
    setRows([]);
    setCursor(null);
    load(null);
  }, [load]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
        <Typography variant="h3">Reviews</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={stars}
          onChange={(_, value) => setStars(value)}
          aria-label="Filter by stars"
        >
          {[5, 4, 3, 2, 1].map((n) => (
            <ToggleButton key={n} value={n} aria-label={`${n} stars`}>
              {n}★
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      {rows.length === 0 && !loading && !error && (
        <Typography color="text.secondary">
          {stars ? `No ${stars}-star reviews.` : "No reviews yet."}
        </Typography>
      )}

      <Stack divider={<Divider flexItem />} spacing={2}>
        {rows.map((review) => (
          <Box key={review.review_id} data-testid="review">
            <Stack direction="row" spacing={1.5} alignItems="center" mb={0.5}>
              <Rating value={Number(review.stars)} readOnly size="small" />
              <Typography variant="caption" color="text.secondary">
                {formatDate(review.review_date)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {review.useful} useful · {review.funny} funny · {review.cool} cool
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
              {review.text}
            </Typography>
          </Box>
        ))}
      </Stack>

      {error && <ErrorState error={error} onRetry={() => load(rows.length ? cursor : null)} />}
      {loading && <LoadingState label="Loading reviews…" height={80} />}
      {!loading && !error && cursor && (
        <Button variant="outlined" onClick={() => load(cursor)} sx={{ alignSelf: "flex-start" }}>
          Load more reviews
        </Button>
      )}
    </Stack>
  );
}
