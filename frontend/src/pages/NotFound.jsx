import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { homeFor } from '../auth/roles';
import { useDocumentTitle } from '../hooks/useApi';

export default function NotFound() {
  useDocumentTitle('Page not found');
  const { user } = useAuth();
  return (
    <main id="main" className="main"><div className="main-inner not-found">
      <h1 id="page-title">This page doesn’t exist</h1>
      <p className="muted">The address may be mistyped, or the page may have moved.</p>
      <div><Link className="btn btn-primary" to={user ? homeFor(user.role) : '/login'}>{user ? 'Go to your portal' : 'Go to sign in'}</Link></div>
    </div></main>
  );
}
