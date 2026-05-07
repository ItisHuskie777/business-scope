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

---

## 4. Folder layout

```
client/
├── index.html              # Vite entry with Google Fonts + Leaflet CSS
├── vite.config.js
├── .env.development        # committed; VITE_API_URL default
├── .env.example            # template for .env.local overrides
├── src/
│   ├── main.jsx            # ReactDOM root, Router, ThemeProvider, CssBaseline
│   ├── App.jsx             # <Layout> + <Routes>
│   ├── theme.js            # MUI theme (palette, typography, shape)
│   ├── index.css           # minimal base styles
│   ├── api/
│   │   └── client.js       # axios instance + 14 route wrappers + ApiError
│   ├── components/
│   │   ├── Layout.jsx      # AppBar + main container + footer
│   │   ├── NavBar.jsx      # top nav with active-link styling
│   │   ├── LoadingState.jsx
│   │   ├── ErrorState.jsx  # renders ApiError with status-aware titles
│   │   └── StarRating.jsx  # read-only star display
│   ├── hooks/
│   │   └── useApi.js       # {data, loading, error, refetch}
│   ├── pages/
│   │   ├── HomePage.jsx               # landing page + city stats chart
│   │   ├── BusinessExplorerPage.jsx   # filters + DataGrid (Colin)
│   │   ├── BusinessDetailPage.jsx     # /business/:id + ZHVI chart
│   │   ├── NeighborhoodsPage.jsx      # placeholder (Eitan)
│   │   ├── MapPage.jsx                # placeholder (Zihan)
│   │   └── NotFoundPage.jsx
│   └── utils/
│       └── validation.js   # mirrors server isValidZip / STATE_RE
```

---

## 5. Pages → backend routes used

| Page                      | Routes consumed                                               |
|---------------------------|----------------------------------------------------------------|
| `/`                       | `GET /city_business_stats`                                     |
| `/businesses`             | `GET /businesses`, `GET /cities`, `GET /zip_codes`             |
| `/business/:id`           | `GET /business/:id`, `GET /housing_trend/:postal_code`         |
| `/neighborhoods`          | *(placeholder — Eitan will use opportunity_score, etc.)*       |
| `/map`                    | *(placeholder — Zihan will use top_business_per_zip, etc.)*    |

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
