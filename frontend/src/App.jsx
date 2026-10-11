import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { homeFor } from './auth/roles';
import RequireRole from './auth/RequireRole';
import { ToastProvider } from './components/Toast';
import { PageLoading } from './components/States';
import AppShell from './layouts/AppShell';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import NotFound from './pages/NotFound';
import StudentDashboard from './pages/student/StudentDashboard';
import NewComplaint from './pages/student/NewComplaint';
import Profile from './pages/shared/Profile';
import ComplaintsPage from './pages/shared/ComplaintsPage';
import ComplaintDetail from './pages/shared/ComplaintDetail';

// Admin pages pull in charts and are only needed by admins: load them on demand.
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const Issues = lazy(() => import('./pages/admin/Issues'));
const AssignStaff = lazy(() => import('./pages/admin/AssignStaff'));
const Categories = lazy(() => import('./pages/admin/Categories'));
const Users = lazy(() => import('./pages/admin/Users'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const Settings = lazy(() => import('./pages/admin/Settings'));

function Home() {
  const { user, status } = useAuth();
  if (status === 'loading') return <div className="main"><PageLoading label="Checking your session" /></div>;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="main"><PageLoading /></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<RequireRole roles={['student']} />}>
          <Route element={<AppShell />}>
            <Route path="/student" element={<StudentDashboard />} />
            <Route path="/student/complaints" element={<ComplaintsPage role="student" />} />
            <Route path="/student/complaints/new" element={<NewComplaint />} />
            <Route path="/student/complaints/:id" element={<ComplaintDetail />} />
            <Route path="/student/profile" element={<Profile />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['staff']} />}>
          <Route element={<AppShell />}>
            <Route path="/staff" element={<ComplaintsPage role="staff" />} />
            <Route path="/staff/complaints/:id" element={<ComplaintDetail />} />
            <Route path="/staff/profile" element={<Profile />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['admin']} />}>
          <Route element={<AppShell />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/complaints" element={<ComplaintsPage role="admin" />} />
            <Route path="/admin/complaints/:id" element={<ComplaintDetail />} />
            <Route path="/admin/issues" element={<Issues />} />
            <Route path="/admin/assign" element={<AssignStaff />} />
            <Route path="/admin/categories" element={<Categories />} />
            <Route path="/admin/users" element={<Users />} />
            <Route path="/admin/reports" element={<Reports />} />
            <Route path="/admin/settings" element={<Settings />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
