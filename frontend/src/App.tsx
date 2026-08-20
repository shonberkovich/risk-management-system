import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import { useAuth } from "./auth/AuthContext";
import Claims from "./pages/Claims";
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import IncidentDetail from "./pages/IncidentDetail";
import IncidentReport from "./pages/IncidentReport";
import Incidents from "./pages/Incidents";
import Login from "./pages/Login";
import Mitigation from "./pages/Mitigation";
import Policies from "./pages/Policies";
import Properties from "./pages/Properties";
import Reports from "./pages/Reports";
import Retention from "./pages/Retention";
import Simulation from "./pages/Simulation";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/properties" element={<Properties />} />
        <Route path="/report-incident" element={<IncidentReport />} />
        <Route path="/incidents" element={<Incidents />} />
        <Route path="/incidents/:id" element={<IncidentDetail />} />
        <Route path="/claims" element={<Claims />} />
        <Route path="/policies" element={<Policies />} />
        <Route path="/mitigation" element={<Mitigation />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/simulation" element={<Simulation />} />
        <Route path="/retention" element={<Retention />} />
        <Route path="/documents" element={<Documents />} />
      </Routes>
    </Layout>
  );
}
