# Frontend Client — CIS 5500 Project Group 35

React + Vite SPA that consumes the Node/Express backend described in
`../server/README.md`. Built with MUI v5, React Router v6, Recharts,
react-leaflet, and axios.

Default dev port: **5173**.

---

## 1. Install dependencies

```bash
cd client
npm install
```

Requires Node.js ≥ 18 (tested on Node 21). Uses Vite 5 which supports that
version range.

---

## 2. Configure the backend URL

The client reads `VITE_API_URL` at build time. A development default is
already provided in `.env.development`:

```
VITE_API_URL=http://localhost:8080
```

If your backend runs somewhere else, copy `.env.example` to `.env.local` and
override the value there. `.env.local` is git-ignored.

---

## 3. Start the dev server

Make sure the backend is running first (see `../server/README.md`), then:

```bash
npm run dev
```

Open <http://localhost:5173/>. HMR is enabled — edits reload automatically.

Other scripts:

| Command           | What it does                    |
|-------------------|---------------------------------|
| `npm run dev`     | Start Vite dev server           |
| `npm run build`   | Production build into `dist/`   |
| `npm run preview` | Serve the production build      |
| `npm run lint`    | Run ESLint across the project   |
| `npm test`        | Run the Vitest unit tests       |

### Bundle layout

Each page is loaded on demand with `React.lazy`, and third-party code is split
into separate vendor chunks (`vite.config.js`). The first load downloads React,
MUI and the page being visited; the data grid, the charts and the map are only
fetched by the pages that use them. See the project README for the measured
sizes.

---

## 4. Folder layout

```
client/
├── index.html              # Vite entry with Google Fonts
├── vite.config.js
├── .env.development        # committed; VITE_API_URL default
├── .env.example            # template for .env.local overrides
├── src/
│   ├── main.jsx            # ReactDOM root, Router, ThemeProvider, CssBaseline
│   ├── App.jsx             # <Layout> + lazily loaded <Routes>
│   ├── theme.js            # MUI theme (palette, typography, shape)
│   ├── index.css           # minimal base styles
│   ├── api/
│   │   └── client.js       # axios instance + 14 route wrappers + ApiError
│   ├── components/
│   │   ├── Layout.jsx      # AppBar + main container + footer
│   │   ├── NavBar.jsx      # top nav with active-link styling and the search box
│   │   ├── SearchBox.jsx   # debounced, cancellable business search
│   │   ├── ReviewFeed.jsx  # cursor-paged reviews with a star filter
│   │   ├── RatingTrendChart.jsx # average stars and review count per month
│   │   ├── LoadingState.jsx
│   │   ├── ErrorState.jsx  # renders ApiError with status-aware titles
│   │   └── StarRating.jsx  # read-only star display
│   ├── hooks/
│   │   ├── useApi.js       # {data, loading, error, refetch}
│   │   └── useDebouncedValue.js
│   ├── pages/
│   │   ├── HomePage.jsx               # landing page + city stats chart
│   │   ├── BusinessExplorerPage.jsx   # filters + DataGrid (Colin)
│   │   ├── BusinessDetailPage.jsx     # /business/:id + ZHVI chart
│   │   ├── NeighborhoodsPage.jsx      # ZIP-level analytics (Eitan)
│   │   ├── ComparePage.jsx            # 2–4 ZIP codes side by side, state in the URL
│   │   ├── MapPage.jsx                # city map + top business per ZIP (Zihan)
│   │   └── NotFoundPage.jsx
│   └── utils/
│       ├── validation.js   # mirrors server isValidZip / STATE_RE (tested in validation.test.js)
│       └── zipList.js      # compare page URL parsing and chart series merging
```

---

## 5. Pages → backend routes used

| Page                      | Routes consumed                                               |
|---------------------------|----------------------------------------------------------------|
| every page (search box)   | `GET /search`                                                  |
| `/`                       | `GET /city_business_stats`, `GET /categories`                  |
| `/businesses`             | `GET /businesses`, `GET /cities`, `GET /zip_codes`, `GET /categories` |
| `/business/:id`           | `GET /business/:id`, `GET /housing_trend/:postal_code`, `GET /business/:id/rating_trend`, `GET /business/:id/reviews` |
| `/compare`                | `GET /compare`, `GET /zip_codes`, `GET /housing_trend/:postal_code` |
| `/neighborhoods`          | `GET /opportunity_score`, `GET /rating_vs_housing`, `GET /high_rated_with_housing`, `GET /business_review_stats` |
| `/map`                    | `GET /city_business_stats`, `GET /top_business_per_zip`, `GET /housing_trend/:postal_code` |

---

## 6. Error handling contract

Every API wrapper in `src/api/client.js` either resolves with the backend's
response JSON or rejects with an `ApiError { message, status }`. The
`ErrorState` component in `src/components/ErrorState.jsx` already maps
`400`, `404`, `504`, and everything else to a friendly title.

Any new page should render `<LoadingState />` when loading and
`<ErrorState error={err} onRetry={refetch} />` when there is an error.

---

## 7. Known backend limitations

- `GET /businesses` is hardcoded to `WHERE postal_code = '19104' AND is_open = 1`.
  The Business Explorer filters for state/city/ZIP are wired and ready; once
  the backend accepts `?postal_code=`, `?city=`, or `?min_stars=` query
  params the UI does not need to change.
