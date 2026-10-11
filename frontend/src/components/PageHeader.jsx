import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useApi';

export default function PageHeader({ title, description, crumbs, actions }) {
  useDocumentTitle(title);
  return (
    <header className="page-head">
      <div>
        {crumbs && (
          <nav aria-label="Breadcrumb" className="crumbs">
            {crumbs.map((c, i) => <span key={c.to}>{i > 0 && ' / '}<Link to={c.to}>{c.label}</Link></span>)}
          </nav>
        )}
        <h1 id="page-title">{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}
