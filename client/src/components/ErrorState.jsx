import { Alert, AlertTitle, Button, Stack } from "@mui/material";

/**
 * Renders an `ApiError` (or any Error) consistently. Maps HTTP status to a
 * friendlier title so the user sees "Request timed out" instead of 504.
 */
export default function ErrorState({ error, onRetry }) {
  const status = error?.status;
  const title =
    status === 400
      ? "Invalid input"
      : status === 404
      ? "Not found"
      : status === 504
      ? "Request timed out"
      : "Something went wrong";

  return (
    <Alert
      severity={status === 404 ? "info" : "error"}
      action={
        onRetry && (
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        )
      }
      sx={{ my: 2 }}
    >
      <AlertTitle>{title}</AlertTitle>
      <Stack spacing={0.5}>
        <span>{error?.message || "Unknown error"}</span>
        {status === 504 && (
          <small>The backend query took longer than 60s. Try narrower filters.</small>
        )}
      </Stack>
    </Alert>
  );
}
