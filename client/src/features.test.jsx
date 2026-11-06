// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "./theme.js";
import * as api from "./api/client.js";
import SearchBox from "./components/SearchBox.jsx";
import ReviewFeed from "./components/ReviewFeed.jsx";
import ComparePage from "./pages/ComparePage.jsx";

// User-level tests for the search box, the review feed and the compare page,
// with the API module replaced by spies.

vi.mock("./api/client.js", () => ({
  searchBusinesses: vi.fn(),
  getBusinessReviews: vi.fn(),
  compareZips: vi.fn(),
  getHousingTrend: vi.fn(),
  getZipCodes: vi.fn(),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderWithRouter(ui, { path = "/", route = "*" } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path={route} element={ui} />
        </Routes>
        <Location />
      </ThemeProvider>
    </MemoryRouter>
  );
}

const review = (n, extra = {}) => ({
  review_id: `r${n}`, stars: "4", useful: 1, funny: 0, cool: 0,
  text: `Review number ${n}`, review_date: "2023-05-01T12:00:00", ...extra,
});

describe("SearchBox", () => {
  const hit = { business_id: "b42", name: "Starbucks", city: "Tampa", state: "FL", categories: "Coffee & Tea" };

  test("searches once typing pauses and opens the chosen business", async () => {
    api.searchBusinesses.mockResolvedValue({ q: "starb", rows: [hit] });
    renderWithRouter(<SearchBox />);

    const input = screen.getByRole("combobox", { name: "Search businesses" });
    fireEvent.change(input, { target: { value: "s" } });
    fireEvent.change(input, { target: { value: "st" } });
    fireEvent.change(input, { target: { value: "starb" } });

    const option = await screen.findByText("Starbucks", {}, { timeout: 3000 });
    // One request for the settled text, not one per keystroke.
    expect(api.searchBusinesses).toHaveBeenCalledTimes(1);
    expect(api.searchBusinesses.mock.calls[0][0]).toBe("starb");
    expect(screen.getByText("Tampa, FL · Coffee & Tea")).toBeTruthy();

    fireEvent.click(option);
    expect(screen.getByTestId("location").textContent).toBe("/business/b42");
  });

  test("does not search for a single character", async () => {
    renderWithRouter(<SearchBox />);
    const input = screen.getByRole("combobox", { name: "Search businesses" });
    fireEvent.change(input, { target: { value: "s" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.searchBusinesses).not.toHaveBeenCalled();
  });

  test("cancels a request that a newer query has replaced", async () => {
    const signals = [];
    api.searchBusinesses.mockImplementation((q, { signal }) => {
      signals.push(signal);
      return new Promise(() => {}); // never settles
    });
    renderWithRouter(<SearchBox />);
    const input = screen.getByRole("combobox", { name: "Search businesses" });

    fireEvent.change(input, { target: { value: "piz" } });
    await waitFor(() => expect(signals).toHaveLength(1), { timeout: 2000 });
    fireEvent.change(input, { target: { value: "pizza" } });
    await waitFor(() => expect(signals).toHaveLength(2), { timeout: 2000 });

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  test("says so when search fails", async () => {
    api.searchBusinesses.mockRejectedValue(new Error("down"));
    renderWithRouter(<SearchBox />);
    const input = screen.getByRole("combobox", { name: "Search businesses" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "starb" } });
    expect(await screen.findByText("Search is unavailable right now", {}, { timeout: 3000 })).toBeTruthy();
  });
});

describe("ReviewFeed", () => {
  test("loads the next page with the cursor from the previous one", async () => {
    api.getBusinessReviews
      .mockResolvedValueOnce({ rows: [review(1), review(2)], next_cursor: "CURSOR-1" })
      .mockResolvedValueOnce({ rows: [review(3)], next_cursor: null });
    renderWithRouter(<ReviewFeed businessId="b1" />);

    expect(await screen.findByText("Review number 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more reviews" }));

    expect(await screen.findByText("Review number 3")).toBeTruthy();
    expect(screen.getAllByTestId("review")).toHaveLength(3);
    expect(api.getBusinessReviews).toHaveBeenLastCalledWith("b1", { cursor: "CURSOR-1", stars: undefined, limit: 10 });
    // Last page: no more button.
    expect(screen.queryByRole("button", { name: "Load more reviews" })).toBeNull();
  });

  test("a star filter starts over from the first page", async () => {
    api.getBusinessReviews
      .mockResolvedValueOnce({ rows: [review(1), review(2)], next_cursor: "CURSOR-1" })
      .mockResolvedValueOnce({ rows: [review(9, { stars: "5", text: "Five stars" })], next_cursor: null });
    renderWithRouter(<ReviewFeed businessId="b1" />);
    await screen.findByText("Review number 1");

    fireEvent.click(screen.getByRole("button", { name: "5 stars" }));
    expect(await screen.findByText("Five stars")).toBeTruthy();
    expect(screen.queryByText("Review number 1")).toBeNull();
    expect(api.getBusinessReviews).toHaveBeenLastCalledWith("b1", { cursor: undefined, stars: 5, limit: 10 });
  });

  test("a slow response for the old filter is discarded", async () => {
    let releaseFirst;
    api.getBusinessReviews
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce({ rows: [review(7, { text: "Filtered" })], next_cursor: null });
    renderWithRouter(<ReviewFeed businessId="b1" />);

    fireEvent.click(screen.getByRole("button", { name: "1 stars" }));
    expect(await screen.findByText("Filtered")).toBeTruthy();
    releaseFirst({ rows: [review(1, { text: "Stale" })], next_cursor: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Stale")).toBeNull();
  });

  test("shows an empty state", async () => {
    api.getBusinessReviews.mockResolvedValue({ rows: [], next_cursor: null });
    renderWithRouter(<ReviewFeed businessId="b1" />);
    expect(await screen.findByText("No reviews yet.")).toBeTruthy();
  });
});

describe("ComparePage", () => {
  const profile = (zip, extra = {}) => ({
    postal_code: zip, found: true, city: "Philadelphia", state: "PA", region_name: `Region ${zip}`,
    business_count: 8, open_count: 6, avg_business_stars: "3.88", total_reviews: 400,
    avg_review_stars: "3.70", latest_zhvi: "310000.50", zhvi_one_year_ago: "300000.00",
    zhvi_change_pct: "3.50", top_categories: [{ category: "Cafes", business_count: 3 }], ...extra,
  });

  beforeEach(() => {
    api.getZipCodes.mockResolvedValue([
      { postal_code: "19104", city: "Philadelphia", state: "PA" },
      { postal_code: "19103", city: "Philadelphia", state: "PA" },
    ]);
    api.getHousingTrend.mockResolvedValue([{ trend_date: "2023-01-31", zhvi_value: "300000" }]);
  });

  test("asks for at least two ZIPs before comparing", async () => {
    renderWithRouter(<ComparePage />, { path: "/compare?zips=19104", route: "/compare" });
    expect(await screen.findByText("Choose at least two ZIP codes to compare.")).toBeTruthy();
    expect(api.compareZips).not.toHaveBeenCalled();
  });

  test("reads the ZIPs from the URL and shows them side by side", async () => {
    api.compareZips.mockResolvedValue({ zips: [profile("19104"), profile("19103", { zhvi_change_pct: "-2.25", open_count: 2 })] });
    renderWithRouter(<ComparePage />, { path: "/compare?zips=19104,19103,bogus", route: "/compare" });

    const table = await screen.findByRole("table", { name: "ZIP comparison" });
    expect(api.compareZips).toHaveBeenCalledWith(["19104", "19103"]);
    expect(api.getHousingTrend).toHaveBeenCalledTimes(2);
    const rowFor = (label) => within(table).getByText(label).closest("tr");
    expect(within(rowFor("Change over the year")).getByText("+3.5%")).toBeTruthy();
    expect(within(rowFor("Change over the year")).getByText("-2.3%")).toBeTruthy();
    expect(within(rowFor("Open now")).getByText("6 (75%)")).toBeTruthy();
    expect(within(table).getAllByText("Cafes · 3")).toHaveLength(2);
    expect(await screen.findByTestId("compare-chart")).toBeTruthy();
  });

  test("flags a ZIP the dataset does not know", async () => {
    api.compareZips.mockResolvedValue({ zips: [profile("19104"), { postal_code: "00000", found: false, business_count: 0, top_categories: [] }] });
    renderWithRouter(<ComparePage />, { path: "/compare?zips=19104,00000", route: "/compare" });
    expect(await screen.findByText("No data for 00000.")).toBeTruthy();
  });

  test("removing a ZIP updates the URL", async () => {
    api.compareZips.mockResolvedValue({ zips: [profile("19104"), profile("19103")] });
    renderWithRouter(<ComparePage />, { path: "/compare?zips=19104,19103", route: "/compare" });
    await screen.findByRole("table", { name: "ZIP comparison" });

    const chip = screen.getAllByText("19103").find((el) => el.closest(".MuiChip-root"));
    fireEvent.click(within(chip.closest(".MuiChip-root")).getByTestId("CancelIcon"));
    expect(screen.getByTestId("location").textContent).toBe("/compare?zips=19104");
  });
});
