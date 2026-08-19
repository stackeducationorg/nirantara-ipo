import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Shell } from './components/Shell';
import { Accounts } from './pages/Accounts';
import { Alerts } from './pages/Alerts';
import { Allotment } from './pages/Allotment';
import { GmpBoard } from './pages/GmpBoard';
import { Home } from './pages/Home';
import { IpoDetail } from './pages/IpoDetail';
import { Landing } from './pages/Landing';
import { Money } from './pages/Money';
import { SignIn } from './pages/SignIn';

export function App() {
  const { account, loading } = useAuth();

  // Hold the first paint until the stored session is either restored or rejected, so neither
  // the landing page nor the sign-in screen flashes for an already-authenticated user.
  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <span className="spinner" style={{ width: 22, height: 22, color: 'var(--text-3)' }} />
      </div>
    );
  }

  // Signed out: the marketing page is the front door, with sign-in on its own route so it can
  // be linked to directly.
  if (!account) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<SignIn />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/gmp" element={<GmpBoard />} />
        <Route path="/allotment" element={<Allotment />} />
        <Route path="/money" element={<Money />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/ipo/:id" element={<IpoDetail />} />
        {/* Signing in lands here, so send the old route to the dashboard. */}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<div className="card empty">Page not found.</div>} />
      </Routes>
    </Shell>
  );
}
