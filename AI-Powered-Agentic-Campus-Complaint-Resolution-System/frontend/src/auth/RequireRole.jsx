import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { homeFor } from './roles';
import { PageLoading } from '../components/States';

/**
 * UX-only guard. The backend enforces every permission independently; this just keeps users on
 * pages they can actually use.
 */
export default function RequireRole({ roles }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoading label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}
