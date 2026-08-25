import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { IconAlert, IconArrowLeft } from '../components/Icons';

/**
 * Android download page.
 *
 * The APK is served straight off the API host rather than bundled into this deployment —
 * a 65MB binary has no business living in a static site build, and nginx streams it from
 * disk without occupying an API worker.
 *
 * Old builds that the update gate has blocked are sent here, so this page has to work for
 * someone who cannot get past their own app's launch screen.
 */
const APK_URL = 'https://api.nirantara.cloud/download/nirantara-ipo.apk';

export function Download() {
  // Shown so a visitor can tell whether the build they already have is current.
  const { data } = useQuery({
    queryKey: ['app-version'],
    queryFn: api.appVersion,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="dl-wrap">
      <Link to="/" className="btn ghost sm" style={{ marginBottom: 26 }}>
        <IconArrowLeft size={13} /> Back to home
      </Link>

      <h1 className="dl-title">Get the Android app</h1>
      <p className="dl-sub">
        Allotment checks across every PAN, live GMP, and a notification the moment results are
        published — without opening a browser.
      </p>

      <a className="dl-button" href={APK_URL} download>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Download for Android
      </a>

      <p className="dl-meta">
        {data ? `Version ${data.latestVersion} · ` : ''}APK · about 66 MB
      </p>

      <div className="dl-steps">
        <h2>Installing it</h2>
        <ol>
          <li>Tap the file once it has downloaded.</li>
          <li>
            Android will warn that it came from outside the Play Store — choose{' '}
            <strong>Settings</strong>, then allow installs from your browser.
          </li>
          <li>Go back and tap <strong>Install</strong>.</li>
        </ol>
        <p className="dl-note">
          <IconAlert size={14} />
          <span>
            That warning is normal for any app installed outside the Play Store. It is the same
            build linked from this page, signed by us.
          </span>
        </p>
      </div>

      <div className="dl-steps">
        <h2>iPhone</h2>
        <p style={{ margin: 0 }}>
          Not available yet. Apple only permits installation through the App Store, so the iOS
          build has to be published there first. Use the website in the meantime — it works fully
          on mobile Safari.
        </p>
      </div>
    </div>
  );
}
