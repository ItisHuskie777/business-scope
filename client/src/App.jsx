import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import HomePage from "./pages/HomePage.jsx";
import BusinessExplorerPage from "./pages/BusinessExplorerPage.jsx";
import BusinessDetailPage from "./pages/BusinessDetailPage.jsx";
import NeighborhoodsPage from "./pages/NeighborhoodsPage.jsx";
import MapPage from "./pages/MapPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/businesses" element={<BusinessExplorerPage />} />
        <Route path="/business/:id" element={<BusinessDetailPage />} />
        <Route path="/neighborhoods" element={<NeighborhoodsPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}
