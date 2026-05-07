import { Box, Container } from "@mui/material";
import NavBar from "./NavBar.jsx";

export default function Layout({ children }) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <NavBar />
      <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 } }}>
        {children}
      </Container>
      <Box
        component="footer"
        sx={{
          py: 3,
          textAlign: "center",
          color: "text.secondary",
          fontSize: 12,
        }}
      >
        CIS 5500 Group 35 · Yelp × Zillow · Spring 2026
      </Box>
    </Box>
  );
}
