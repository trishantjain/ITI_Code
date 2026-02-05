import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import DashboardView from './pages/DashboardView';
import AdminDashboard from './pages/AdminDashboard';
import PrivateRoute from './components/PrivateRoute';
import OfflinePrompt from './components/OfflinePrompt';
import DashboardTest from './pages/DashboardTest';

function App() {
  const [offlinePrompt, setOfflinePrompt] = useState(false);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_API_URL}/ping`, { method: 'GET' });
        if (!res.ok) throw new Error('Offline');
        setOfflinePrompt(false);
      } catch (err) {
        setOfflinePrompt(true);
      }
    };

    checkConnection(); // check on load
    const interval = setInterval(checkConnection, 10000); // repeat every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <Router>
      <OfflinePrompt show={offlinePrompt} />
      <Routes>
        <Route path="/" element={<Login />} />

        {/* ✅ Authenticated User Dashboard */}
        <Route
          path="/dashboard"
          element={
            <PrivateRoute allowedRoles={['user', 'block', 'gp']}>
              <DashboardView />
            </PrivateRoute>
          }
        />
        <Route
          path="/dashboard_test"
          element={
            <DashboardTest />
          }
        />

        {/* ✅ Admin Dashboard */}
        <Route
          path="/admin"
          element={
            <PrivateRoute allowedRoles={['admin']}>
              <AdminDashboard />
            </PrivateRoute>
          }
        />

        {/* Fallback route */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
