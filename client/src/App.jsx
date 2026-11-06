import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import LoadingState from "./components/LoadingState.jsx";

// Each page is its own chunk, fetched the first time its route is visited.
// The data grid, the charts and the map are only downloaded by the pages that
// use them instead of being part of the first load.
const HomePage = lazy(() => import("./pages/HomePage.jsx"));
const BusinessExplorerPage = lazy(() => import("./pages/BusinessExplorerPage.jsx"));
const BusinessDetailPage = lazy(() => import("./pages/BusinessDetailPage.jsx"));
const NeighborhoodsPage = lazy(() => import("./pages/NeighborhoodsPage.jsx"));
const MapPage = lazy(() => import("./pages/MapPage.jsx"));
const ComparePage = lazy(() => import("./pages/ComparePage.jsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.jsx"));

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<LoadingState label="Loading page…" />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/businesses" element={<BusinessExplorerPage />} />
          <Route path="/business/:id" element={<BusinessDetailPage />} />
          <Route path="/neighborhoods" element={<NeighborhoodsPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
