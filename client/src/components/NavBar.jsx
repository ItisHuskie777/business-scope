import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Button,
  Container,
} from "@mui/material";
import StoreMallDirectoryIcon from "@mui/icons-material/StoreMallDirectory";
import { NavLink, Link } from "react-router-dom";

const LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/businesses", label: "Business Explorer" },
  { to: "/neighborhoods", label: "Neighborhoods" },
  { to: "/map", label: "Map" },
];

export default function NavBar() {
  return (
    <AppBar position="sticky" color="primary" elevation={0}>
      <Container maxWidth="xl" disableGutters>
        <Toolbar sx={{ gap: 2, px: { xs: 2, md: 3 } }}>
          <Box
            component={Link}
            to="/"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              color: "inherit",
              mr: 2,
            }}
          >
            <StoreMallDirectoryIcon />
            <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
              NBOE
            </Typography>
            <Typography
              variant="body2"
              sx={{ ml: 1, opacity: 0.8, display: { xs: "none", md: "block" } }}
            >
              Neighborhood Business Opportunity Explorer
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {LINKS.map((link) => (
              <Button
                key={link.to}
                component={NavLink}
                to={link.to}
                end={link.end}
                color="inherit"
                sx={(theme) => ({
                  px: 1.5,
                  "&.active": {
                    backgroundColor: "rgba(255,255,255,0.12)",
                    color: theme.palette.common.white,
                  },
                })}
              >
                {link.label}
              </Button>
            ))}
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
