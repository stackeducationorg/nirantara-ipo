import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { IpoList, Section } from '../components/IpoCard';
import { IconChevronRight, IconInfo } from '../components/Icons';
import type { Ipo } from '../types';

function Loading() {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton" style={{ height: 66 }} />
      ))}
    </div>
  );
}

export function Home() {
  // SME and mainboard issues have very different lot sizes and risk, so they are never mixed:
  // the toggle switches between them rather than adding SME to the mainboard list.
  const [smeOnly, setSmeOnly] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
    refetchInterval: 5 * 60_000,
  });
  const { data: pans } = useQuery({ queryKey: ['pans'], queryFn: api.pans });

  const only = (items: Ipo[] | undefined): Ipo[] =>
    (items ?? []).filter((ipo) => (smeOnly ? ipo.category === 'SME' : ipo.category !== 'SME'));

  const inAllotmentWindow = only(data?.awaitingAllotment);
  // The date-derived status only says the allotment window has opened. Splitting on whether
  // the registrar is actually answering stops a published result reading as "awaiting".
  const resultsOut = inAllotmentWindow.filter((i) => i.allotmentLive);
  const awaiting = inAllotmentWindow.filter((i) => !i.allotmentLive);
  const open = only(data?.open);
  const upcoming = only(data?.upcoming);
  const listed = only(data?.recentlyListed);

  const kind = smeOnly ? 'SME' : 'mainboard';

  return (
    <div>
      <h1 className="page-title">IPOs</h1>
      <p className="page-sub">Live grey market premium, subscription and allotment tracking.</p>

      <div className="chips">
        <button className={`chip ${smeOnly ? '' : 'active'}`} onClick={() => setSmeOnly(false)}>
          Mainboard
        </button>
        <button className={`chip ${smeOnly ? 'active' : ''}`} onClick={() => setSmeOnly(true)}>
          SME
        </button>
      </div>

      {/* Allotment checking is inert without a PAN, so this is the first thing a new user sees. */}
      {pans && pans.length === 0 && (
        <Link to="/accounts" className="banner info">
          <IconInfo size={16} />
          <span>
            <strong>Add your PAN</strong> to check allotment across every account automatically.
          </span>
        </Link>
      )}

      {error && (
        <div className="banner error">
          <IconInfo size={16} />
          <span>{(error as Error).message}</span>
        </div>
      )}

      {isLoading ? (
        <Loading />
      ) : (
        <>
          {resultsOut.length > 0 && (
            <Section
              title="Results out"
              count={resultsOut.length}
              action={
                <Link to="/allotment" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  Check all <IconChevronRight size={13} />
                </Link>
              }
            >
              <IpoList items={resultsOut} empty="" />
            </Section>
          )}

          {awaiting.length > 0 && (
            <Section title="Awaiting allotment" count={awaiting.length}>
              <IpoList items={awaiting} empty="" />
            </Section>
          )}

          <Section title="Open now" count={open.length}>
            <IpoList items={open} empty={`No ${kind} IPOs are open for applications right now.`} />
          </Section>

          <Section title="Upcoming" count={upcoming.length}>
            <IpoList items={upcoming} empty={`No upcoming ${kind} IPOs announced yet.`} />
          </Section>

          {listed.length > 0 && (
            <Section title="Recently listed" count={listed.length}>
              <IpoList items={listed} empty="" />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
