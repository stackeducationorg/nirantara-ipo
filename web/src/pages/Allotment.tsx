import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Logo, Section } from '../components/IpoCard';
import { IconChevronRight, IconInbox, IconWallet } from '../components/Icons';
import { money, num, relativeTime, shortDate } from '../format';

export function Allotment() {
  const queryClient = useQueryClient();

  const { data: history, isLoading } = useQuery({
    queryKey: ['allotment-history'],
    queryFn: api.allotmentHistory,
  });
  const { data: pans } = useQuery({ queryKey: ['pans'], queryFn: api.pans });
  const { data: dashboard } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });

  const checkAll = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      // Only issues whose allotment date has arrived can return anything useful.
      const due = (dashboard?.awaitingAllotment ?? []).filter((i) => i.boaDate && i.boaDate <= today);
      const settled = await Promise.allSettled(due.map((i) => api.checkAllotment(i.id)));
      return settled.filter((s) => s.status === 'fulfilled').length;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['allotment-history'] }),
  });

  const activePans = (pans ?? []).filter((p) => p.isActive);
  const totalWon = (history ?? []).reduce((sum, row) => sum + row.totalAmount, 0);
  const totalAllotted = (history ?? []).reduce((sum, row) => sum + row.allottedAccounts, 0);

  if (activePans.length === 0) {
    return (
      <div>
        <h1 className="page-title">Allotment</h1>
        <p className="page-sub">Every saved PAN, checked together, automatically.</p>
        <div className="card empty">
          <IconWallet size={26} />
          <div style={{ marginBottom: 14 }}>No PANs saved yet.</div>
          <Link to="/accounts" className="btn primary">
            Add a PAN
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Allotment</h1>
      <p className="page-sub">
        Every saved PAN, checked together. Results arrive as a notification the moment they go live.
      </p>

      <div className="card card-pad" style={{ marginBottom: 22 }}>
        <div className="stat-grid" style={{ border: 'none' }}>
          <div className="stat">
            <div className="stat-label">Accounts</div>
            <div className="stat-value mono" style={{ fontSize: 20 }}>
              {activePans.length}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Allotments won</div>
            <div className="stat-value mono pos" style={{ fontSize: 20 }}>
              {totalAllotted}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Total value</div>
            <div className="stat-value mono" style={{ fontSize: 20 }}>
              {money(totalWon)}
            </div>
          </div>
        </div>

        <button
          className="btn block"
          style={{ marginTop: 16 }}
          disabled={checkAll.isPending}
          onClick={() => checkAll.mutate()}
        >
          {checkAll.isPending && <span className="spinner" />}
          {checkAll.isPending ? 'Checking every pending IPO…' : 'Re-check all pending IPOs'}
        </button>
        {checkAll.isSuccess && (
          <div className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 9 }}>
            Checked {checkAll.data} IPO{checkAll.data === 1 ? '' : 's'}.
          </div>
        )}
      </div>

      {dashboard && dashboard.awaitingAllotment.length > 0 && (
        <Section title="Waiting on results" count={dashboard.awaitingAllotment.length}>
          <div className="ipo-list">
            {dashboard.awaitingAllotment.map((ipo) => (
              <Link key={ipo.id} to={`/ipo/${ipo.id}`} className="ipo-row">
                <Logo ipo={ipo} />
                <div className="ipo-main">
                  <div className="ipo-name">{ipo.name}</div>
                  <div className="ipo-meta">Allotment {shortDate(ipo.boaDate)}</div>
                </div>
                <IconChevronRight size={15} className="faint" />
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="History" count={history?.length}>
        {isLoading ? (
          <div className="skeleton" style={{ height: 160 }} />
        ) : (history ?? []).length === 0 ? (
          <div className="card empty">
            <IconInbox size={26} />
            <div>No allotments checked yet.</div>
          </div>
        ) : (
          <div className="ipo-list">
            {history!.map((row) => {
              const won = row.allottedAccounts > 0;
              return (
                <Link key={row.ipoId} to={`/ipo/${row.ipoId}`} className="ipo-row">
                  <Logo ipo={{ name: row.ipoName, logoUrl: row.logoUrl }} />
                  <div className="ipo-main">
                    <div className="ipo-name">{row.ipoName}</div>
                    <div className="ipo-meta">
                      {shortDate(row.boaDate)} · checked {relativeTime(row.checkedAt)}
                    </div>
                  </div>
                  <div className="ipo-right">
                    <div className={`mono ${won ? 'pos' : 'faint'}`} style={{ fontWeight: 620 }}>
                      {row.allottedAccounts}/{row.totalAccounts}
                    </div>
                    <div className="ipo-right-sub mono">
                      {won ? `${num(row.totalShares)} sh · ${money(row.totalAmount)}` : 'no allotment'}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
