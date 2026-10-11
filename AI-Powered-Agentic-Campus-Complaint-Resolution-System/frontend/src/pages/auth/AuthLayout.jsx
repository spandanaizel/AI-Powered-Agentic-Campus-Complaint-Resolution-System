import { Link } from 'react-router-dom';

export default function AuthLayout({ children }) {
  return (
    <div className="auth">
      <section className="auth-aside" aria-label="About this service">
        <Link to="/" className="brand"><img src="/favicon.svg" alt="" width="32" height="32" /> Campus Complaint Desk</Link>
        <div>
          <h1>Report a campus problem once. Follow it until it’s fixed.</h1>
          <ol>
            <li>Describe the problem and where it is.</li>
            <li>It goes to the staff team for that kind of issue.</li>
            <li>You see every status change and reply in one place.</li>
          </ol>
        </div>
        <p className="small" style={{ color: '#aab3c0', margin: 0 }}>When several students report the same problem in the same place, it is raised to the highest priority automatically.</p>
      </section>
      <main className="auth-main" id="main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}
