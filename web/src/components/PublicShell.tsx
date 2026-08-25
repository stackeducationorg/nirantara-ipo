import { Link, NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * Chrome for pages a signed-out visitor can reach: the GMP board, IPO detail pages and the
 * legal documents.
 *
 * These pages are the entire surface Google can see — everything else needs an account — so
 * the header and footer exist as much for crawlers as for people. They give every public page
 * internal links to the other public pages, which is how a crawler discovers the site beyond
 * whatever single URL it landed on.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className="pub">
      <header className="pub-head">
        <Link to="/" className="pub-brand">
          <img src="/logo-mark.png" alt="" width={22} height={22} />
          Nirantara IPO
        </Link>

        <nav className="pub-nav">
          <NavLink to="/gmp">Live GMP</NavLink>
        </nav>

        <div className="pub-actions">
          <Link to="/login" className="btn">
            Log in
          </Link>
          <Link to="/login?mode=signup" className="btn primary">
            Get started
          </Link>
        </div>
      </header>

      <main className="pub-body">{children}</main>

      <footer className="pub-foot">
        <div className="pub-foot-inner">
          <span>
            <strong>Nirantara IPO</strong> © {year}
          </span>
          <div className="pub-foot-links">
            <Link to="/gmp">Live GMP</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/disclaimer">Disclaimer</Link>
          </div>
        </div>
        <p className="pub-foot-note">
          Grey market premium is an unofficial, unregulated signal compiled from publicly
          reported figures. It is not a prediction of listing price, and nothing here is
          investment advice.
        </p>
      </footer>
    </div>
  );
}
