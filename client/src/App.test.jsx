// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "./theme.js";
import App from "./App.jsx";

// Every page is loaded lazily, so a broken import or a page that throws on its
// first render would only show up at runtime. These tests render the real app
// on each route with the API replaced by canned responses.

const api = vi.hoisted(() => ({
  business: {
    business_id: "b1", name: "Blue Door Cafe", address: "100 Main St", city: "Philadelphia",
    state: "PA", postal_code: "19104", stars: "4.5", is_open: 1,
    categories: "Coffee & Tea, Cafes", hours: null, total_reviews: 72, avg_review_stars: "4.31",
  },
}));

vi.mock("./api/client.js", () => {
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  const zipRow = {
    postal_code: "19104", city: "Philadelphia", business_count: 7,
    avg_business_stars: "3.90", avg_review_stars: "3.75", avg_business_rating: "3.9",
    avg_review_rating: "3.75", total_reviews: "412", latest_zhvi: "310000.50", zhvi_growth: "42000.00",
  };
  return {
    API_URL: "http://localhost:8080",
    ApiError,
    getBusinesses: vi.fn(async () => ({ page: 1, limit: 500, rows: [api.business] })),
    getPostalCodeStats: vi.fn(async () => []),
    getCityBusinessStats: vi.fn(async () => [{ city: "Philadelphia", num_businesses: 24 }, { city: "Tampa", num_businesses: 16 }]),
    getBusinessReviewStats: vi.fn(async () => ({
      page: 1, limit: 200, offset: 0, min_reviews: 100, top_n: 5,
      rows: [{ business_id: "b1", name: "Blue Door Cafe", postal_code: "19104", city: "Philadelphia", total_reviews: 72, avg_review_rating: "4.31", city_review_rank: 1 }],
    })),
    getHighRatedWithHousing: vi.fn(async () => [{ business_id: "b1", name: "Blue Door Cafe", postal_code: "19104", review_count: 72, avg_review_stars: "4.31", latest_zhvi: "310000.50" }]),
    getTopBusinessPerZip: vi.fn(async () => [{ postal_code: "19104", name: "Blue Door Cafe", review_count: 72 }]),
    getHousingTrend: vi.fn(async () => [
      { postal_code: "19104", trend_date: "2023-01-28T00:00:00.000Z", zhvi_value: "300000.50" },
      { postal_code: "19104", trend_date: "2023-02-28T00:00:00.000Z", zhvi_value: "310000.50" },
    ]),
    getRatingVsHousing: vi.fn(async () => [zipRow]),
    getZipBusinessCount: vi.fn(async () => []),
    getMonthlyHousing: vi.fn(async () => []),
    getOpportunityScore: vi.fn(async () => [zipRow]),
    getCities: vi.fn(async () => [{ city: "Philadelphia", state: "PA" }]),
    getZipCodes: vi.fn(async () => [{ postal_code: "19104", city: "Philadelphia", state: "PA" }]),
    getBusinessById: vi.fn(async (id) => {
      if (id === "missing") throw new ApiError("Business not found", 404);
      return api.business;
    }),
  };
});

// Leaflet draws with SVG or canvas, neither of which jsdom implements. The map
// widgets are replaced by plain elements; everything around them renders for real.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ children }) => <div data-testid="marker">{children}</div>,
  Tooltip: ({ children }) => <span>{children}</span>,
}));

beforeAll(() => {
  // jsdom has no layout engine; the charts and the data grid only need these to exist.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  window.scrollTo = () => {};
});

afterEach(cleanup);

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider theme={theme}>
        <App />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe("lazy-loaded routes", () => {
  test("shows the loading fallback while the page chunk is being fetched", () => {
    renderAt("/");
    expect(screen.getByText("Loading page…")).toBeTruthy();
  });

  test.each([
    ["/", "Top cities by business count"],
    ["/businesses", "Business Explorer"],
    ["/neighborhoods", "Neighborhood Analytics"],
    ["/map", "Map & Recommendations"],
    ["/no-such-page", "Page not found"],
  ])("%s renders its page", async (path, heading) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    renderAt(path);
    expect(await screen.findByText(heading, {}, { timeout: 15000 })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Loading page…")).toBeNull());
    // A page that threw while rendering would have been reported by React.
    const crashes = errors.mock.calls.filter(([first]) => /The above error occurred|Uncaught/.test(String(first)));
    expect(crashes).toEqual([]);
    errors.mockRestore();
  }, 20000);

  test("/business/:id shows the business returned by the API", async () => {
    renderAt("/business/b1");
    expect(await screen.findByText("Blue Door Cafe", {}, { timeout: 15000 })).toBeTruthy();
    expect(await screen.findByText("Housing trend")).toBeTruthy();
  }, 20000);

  test("/business/:id shows an error state, not a blank page, when the business does not exist", async () => {
    renderAt("/business/missing");
    // The alert shows a 404-specific title and the API's own message.
    const matches = await screen.findAllByText(/not found/i, {}, { timeout: 15000 });
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByText("Business not found")).toBeTruthy();
    expect(screen.queryByText("Blue Door Cafe")).toBeNull();
  }, 20000);
});
