import { createTheme } from "@mui/material/styles";

/**
 * Project theme. Uses a deep teal primary with a warm coral accent to evoke
 * "neighborhood" and "opportunity" without leaning on the default MUI blue.
 */
const theme = createTheme({
  palette: {
    primary: {
      main: "#1E4D6B",
      dark: "#123347",
      light: "#527C9B",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#E76F51",
      dark: "#B5553B",
      light: "#F4A48D",
      contrastText: "#FFFFFF",
    },
    background: {
      default: "#F5F7F9",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#1A2B3C",
      secondary: "#5B6B7B",
    },
  },
  typography: {
    fontFamily:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h1: { fontSize: "2.5rem", fontWeight: 700, letterSpacing: "-0.02em" },
    h2: { fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.015em" },
    h3: { fontSize: "1.5rem", fontWeight: 600 },
    h4: { fontSize: "1.25rem", fontWeight: 600 },
    h5: { fontSize: "1.125rem", fontWeight: 600 },
    h6: { fontSize: "1rem", fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: { borderRadius: 12 },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid #E4E9EE",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        },
      },
    },
  },
});

export default theme;
