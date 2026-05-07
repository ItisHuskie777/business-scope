import { Button, Stack, Typography } from "@mui/material";
import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <Stack spacing={2} alignItems="flex-start" sx={{ py: 6 }}>
      <Typography variant="h2">Page not found</Typography>
      <Typography color="text.secondary">
        The page you were looking for does not exist.
      </Typography>
      <Button component={Link} to="/" variant="contained">
        Back to home
      </Button>
    </Stack>
  );
}
