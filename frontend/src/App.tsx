import { Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import Claims from "./pages/Claims";
import Dashboard from "./pages/Dashboard";
import IncidentReport from "./pages/IncidentReport";
import Mitigation from "./pages/Mitigation";
import Properties from "./pages/Properties";
import Reports from "./pages/Reports";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/properties" element={<Properties />} />
        <Route path="/report-incident" element={<IncidentReport />} />
        <Route path="/claims" element={<Claims />} />
        <Route path="/mitigation" element={<Mitigation />} />
        <Route path="/reports" element={<Reports />} />
      </Routes>
    </Layout>
  );
}
