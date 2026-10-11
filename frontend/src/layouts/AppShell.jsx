import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { FiMenu, FiX, FiHome, FiPlusSquare, FiList, FiUser, FiInbox, FiUsers, FiTag, FiBarChart2, FiSettings, FiAlertOctagon, FiShuffle, FiLogOut } from 'react-icons/fi';
import { useAuth } from '../auth/AuthContext';
import { homeFor } from '../auth/roles';
import ErrorBoundary from '../components/ErrorBoundary';

const NAV = {
  student: [
    { to: '/student', label: 'Overview', icon: FiHome, end: true },
    { to: '/student/complaints/new', label: 'Report a problem', icon: FiPlusSquare },
    { to: '/student/complaints', label: 'My complaints', icon: FiList, end: true },
    { to: '/student/profile', label: 'Profile', icon: FiUser },
  ],
  staff: [
    { to: '/staff', label: 'My queue', icon: FiInbox, end: true },
    { to: '/staff/profile', label: 'Profile', icon: FiUser },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: FiHome, end: true },
    { to: '/admin/complaints', label: 'All complaints', icon: FiList },
    { to: '/admin/issues', label: 'Repeated issues', icon: FiAlertOctagon },
    { to: '/admin/assign', label: 'Staff coverage', icon: FiShuffle },
    { to: '/admin/categories', label: 'Categories & locations', icon: FiTag },
    { to: '/admin/users', label: 'Users', icon: FiUsers },
    { to: '/admin/reports', label: 'Reports', icon: FiBarChart2 },
    { to: '/admin/settings', label: 'Settings', icon: FiSettings },
  ],
};
const PORTAL = { student: 'Student portal', staff: 'Staff portal', admin: 'Admin portal' };

function Brand({ role }) {
  return (
    <Link to={homeFor(role)} className="brand" aria-label="Campus Complaint Desk, go to portal home">
      <img src="/favicon.svg" alt="" width="32" height="32" />
      <span>Campus Complaint Desk<small>{PORTAL[role]}</small></span>
    </Link>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // The drawer is open only for the path it was opened on, so navigating closes it without an effect.
  const [openFor, setOpenFor] = useState(null);
  const open = openFor === location.pathname;
  const setOpen = (v) => setOpenFor((typeof v === 'function' ? v(open) : v) ? location.pathname : null);
  const menuBtn = useRef(null);
  const mainRef = useRef(null);

  // Close the drawer on navigation and move focus to the new page for screen-reader users.
  // After in-app navigation, move focus to the new page for screen-reader and keyboard users.
  // Not on first load, so the skip link stays the first thing Tab reaches.
  const firstPath = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname === firstPath.current) return;
    firstPath.current = null;
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpenFor(null); menuBtn.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!user) return null;
  const doLogout = async () => { await logout(); navigate('/login', { replace: true }); };

  return (
    <>
      <a href="#main" className="skip-link">Skip to main content</a>
      <div className="topbar">
        <button ref={menuBtn} type="button" className="icon-btn" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen((o) => !o)}>
          {open ? <FiX aria-hidden="true" size={20} /> : <FiMenu aria-hidden="true" size={20} />}
          <span className="visually-hidden">{open ? 'Close menu' : 'Open menu'}</span>
        </button>
        <Brand role={user.role} />
      </div>
      <div className="shell">
        {open && <button type="button" className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
        <aside id="sidebar" className={`sidebar${open ? ' open' : ''}`} aria-label="Main">
          <Brand role={user.role} />
          <nav className="nav" aria-label={PORTAL[user.role]}>
            {NAV[user.role].map((item) => {
              const Icon = item.icon;
              return <NavLink key={item.to} to={item.to} end={item.end}><Icon aria-hidden="true" /> {item.label}</NavLink>;
            })}
          </nav>
          <div className="sidebar-foot">
            <div className="who">{user.name}</div>
            <div className="role">{user.role}</div>
            <button type="button" className="btn btn-sm btn-on-dark" onClick={doLogout}><FiLogOut aria-hidden="true" /> Sign out</button>
          </div>
        </aside>
        <main id="main" className="main" ref={mainRef} tabIndex={-1} aria-labelledby="page-title">
          <div className="main-inner">
            <ErrorBoundary key={location.pathname}><Outlet /></ErrorBoundary>
          </div>
        </main>
      </div>
    </>
  );
}
