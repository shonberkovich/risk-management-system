import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import { useAuth } from "./auth/AuthContext";
import AuditLog from "./pages/AuditLog";
import Claims from "./pages/Claims";
import Compliance from "./pages/Compliance";
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import IncidentDetail from "./pages/IncidentDetail";
import IncidentReport from "./pages/IncidentReport";
import Incidents from "./pages/Incidents";
import Login from "./pages/Login";
import Mitigation from "./pages/Mitigation";
import Policies from "./pages/Policies";
import Properties from "./pages/Properties";
import PropertyDetail from "./pages/PropertyDetail";
import Reports from "./pages/Reports";
import Retention from "./pages/Retention";
import Roles from "./pages/Roles";
import Simulation from "./pages/Simulation";
import Users from "./pages/Users";

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
        <Route path="/properties/:id" element={<PropertyDetail />} />
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
        <Route path="/compliance" element={<Compliance />} />
        <Route path="/audit-log" element={<AuditLog />} />
        <Route path="/users" element={<Users />} />
        <Route path="/roles" element={<Roles />} />
      </Routes>
    </Layout>
  );
}
