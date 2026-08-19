import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { IpoList, Section } from '../components/IpoCard';
import { IconChevronRight, IconInfo } from '../components/Icons';

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
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
    refetchInterval: 5 * 60_000,
  });
  const { data: pans } = useQuery({ queryKey: ['pans'], queryFn: api.pans });

  return (
    <div>
      <h1 className="page-title">IPOs</h1>
      <p className="page-sub">Live grey market premium, subscription and allotment tracking.</p>

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
          {data && data.awaitingAllotment.length > 0 && (
            <Section
              title="Awaiting allotment"
              count={data.awaitingAllotment.length}
              action={
                <Link to="/allotment" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  Check all <IconChevronRight size={13} />
                </Link>
              }
            >
              <IpoList items={data.awaitingAllotment} empty="" />
            </Section>
          )}

          <Section title="Open now" count={data?.open.length}>
            <IpoList items={data?.open ?? []} empty="No IPOs are open for applications right now." />
          </Section>

          <Section title="Upcoming" count={data?.upcoming.length}>
            <IpoList items={data?.upcoming ?? []} empty="No upcoming IPOs announced yet." />
          </Section>

          {data && data.recentlyListed.length > 0 && (
            <Section title="Recently listed" count={data.recentlyListed.length}>
              <IpoList items={data.recentlyListed} empty="" />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
