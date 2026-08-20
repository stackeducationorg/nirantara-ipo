import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useThemeMode, type ThemeMode } from '../theme';
import { FallingStars } from './FallingStars';
import { Logo } from './IpoCard';
import {
  IconBell,
  IconList,
  IconLogout,
  IconMonitor,
  IconMoon,
  IconSearch,
  IconSun,
  IconTarget,
  IconTrend,
  IconUser,
  IconWallet,
} from './Icons';

const NAV = [
  { to: '/', label: 'IPOs', Icon: IconList, end: true },
  { to: '/gmp', label: 'GMP', Icon: IconTrend, end: false },
  { to: '/allotment', label: 'Allotment', Icon: IconTarget, end: false },
  { to: '/money', label: 'Money', Icon: IconWallet, end: false },
  { to: '/accounts', label: 'Accounts', Icon: IconUser, end: false },
];

/** Cmd/Ctrl-K palette for jumping straight to an IPO. */
function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: ipos } = useQuery({ queryKey: ['ipos-all'], queryFn: () => api.ipos() });

  useEffect(() => inputRef.current?.focus(), []);

  const results = (ipos ?? [])
    .filter((ipo) => ipo.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);

  const go = (index: number) => {
    const hit = results[index];
    if (!hit) return;
    navigate(`/ipo/${hit.id}`);
    onClose();
  };

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="search-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <IconSearch size={17} />
          <input
            ref={inputRef}
            placeholder="Search IPOs…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              }
              if (e.key === 'Enter') go(active);
            }}
          />
          <kbd style={{ background: 'var(--surface-3)', borderRadius: 4, padding: '2px 5px', fontSize: 11 }}>
            Esc
          </kbd>
        </div>

        <div className="search-results">
          {results.length === 0 ? (
            <div className="empty" style={{ padding: '28px 20px' }}>
              {query ? 'No matching IPOs.' : 'Start typing to search.'}
            </div>
          ) : (
            results.map((ipo, index) => (
              <div
                key={ipo.id}
                className="search-item"
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(index)}
              >
                <Logo ipo={ipo} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row-title">{ipo.name}</div>
                  <div className="row-sub">
                    {ipo.priceText ? `₹${ipo.priceText}` : '—'} · {ipo.status}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { mode, cycle } = useThemeMode();
  const Icon = mode === 'light' ? IconSun : mode === 'dark' ? IconMoon : IconMonitor;
  const label: Record<ThemeMode, string> = {
    light: 'Light theme',
    dark: 'Dark theme',
    system: 'System theme',
  };

  return (
    <button className="icon-btn" onClick={cycle} title={label[mode]} aria-label={label[mode]}>
      <Icon size={16} />
    </button>
  );
}

function ProfileMenu() {
  const { account, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="Account menu">
        <IconUser size={16} />
      </button>

      {open && (
        <div className="menu" role="menu">
          <div className="menu-label">{account?.email ?? 'Signed in'}</div>
          <button
            className="menu-item"
            onClick={() => {
              navigate('/accounts');
              setOpen(false);
            }}
          >
            <IconWallet size={15} /> Accounts
          </button>
          <button
            className="menu-item"
            onClick={() => {
              navigate('/alerts');
              setOpen(false);
            }}
          >
            <IconBell size={15} /> Alerts
          </button>
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={() => void logout()}>
            <IconLogout size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Footer() {
  const { mode, cycle } = useThemeMode();
  const Icon = mode === 'light' ? IconSun : mode === 'dark' ? IconMoon : IconMonitor;
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <FallingStars />
      <div className="footer-inner">
        <div className="footer-cols">
          <div className="footer-col">
            <h4>Product</h4>
            <NavLink to="/">IPO calendar</NavLink>
            <NavLink to="/gmp">Live GMP</NavLink>
            <NavLink to="/allotment">Allotment check</NavLink>
            <NavLink to="/money">Money tracker</NavLink>
            <NavLink to="/alerts">Alerts</NavLink>
          </div>
          <div className="footer-col">
            <h4>Data</h4>
            <span>Registrars</span>
            <span>Subscription figures</span>
            <span>Grey market premium</span>
          </div>
          <div className="footer-col">
            <h4>Legal</h4>
            <NavLink to="/terms">Terms of Service</NavLink>
            <NavLink to="/privacy">Privacy Policy</NavLink>
            <NavLink to="/disclaimer">Disclaimer</NavLink>
          </div>
        </div>

        <div className="footer-bottom">
          <span>
            All rights reserved to <strong style={{ color: 'var(--text-2)' }}>Nirantara IPO</strong> © {year}.
          </span>
          <div className="footer-credit">
            <span>
              Developed by{' '}
              <a href="https://stackeducation.in" target="_blank" rel="noreferrer noopener">
                stackeducation.in
              </a>
            </span>
            <button className="icon-btn" onClick={cycle} aria-label="Change theme" title="Change theme">
              <Icon size={15} />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();

  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: api.unreadCount,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <NavLink to="/" className="brand">
          <img className="brand-logo" src="/logo-mark.png" alt="" />
          <span>Nirantara IPO</span>
        </NavLink>

        <div className="header-spacer" />

        <button className="search" onClick={() => setSearchOpen(true)}>
          <IconSearch size={15} />
          <span>Search IPOs…</span>
          <kbd>Ctrl K</kbd>
        </button>

        <button className="icon-btn" onClick={() => navigate('/alerts')} aria-label="Alerts">
          <IconBell size={16} />
          {(unread?.count ?? 0) > 0 && <span className="badge-dot">{unread!.count}</span>}
        </button>

        <ThemeToggle />
        <ProfileMenu />
      </header>

      <nav className="nav" style={{ justifyContent: 'center', padding: '10px 0 0' }}>
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <main className="main">{children}</main>
      <Footer />

      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
