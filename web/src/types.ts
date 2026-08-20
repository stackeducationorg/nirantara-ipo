export type IpoStatus = 'upcoming' | 'open' | 'closed' | 'allotment' | 'listed';

export interface Ipo {
  id: string;
  igId: number | null;
  name: string;
  slug: string | null;
  category: string | null;
  exchange: string | null;
  status: IpoStatus;
  priceText: string | null;
  priceMin: number | null;
  priceMax: number | null;
  lotSize: number | null;
  lotAmount: number | null;
  issueSize: string | null;
  openDate: string | null;
  closeDate: string | null;
  boaDate: string | null;
  listingDate: string | null;
  logoUrl: string | null;
  registrar: string | null;
  subscription: Record<string, string | null> | null;
  gmp: number | null;
  gmpPercent: number | null;
  estListingPrice: number | null;
  gmpUpdatedAt: string | null;
  daysToClose: number | null;
  daysToAllotment: number | null;
  /** True once the registrar is actually answering allotment queries for this issue. */
  allotmentLive: boolean;
  gmpHistory?: GmpPoint[];
}

export interface GmpPoint {
  gmp: number;
  gmp_percent: number | null;
  est_listing: number | null;
  captured_at: string;
}

export interface Dashboard {
  open: Ipo[];
  upcoming: Ipo[];
  awaitingAllotment: Ipo[];
  recentlyListed: Ipo[];
  updatedAt: string;
}

export interface Pan {
  id: string;
  label: string;
  /** Masked PAN, or null when the entry was saved with only a demat number. */
  pan: string | null;
  /** Masked demat number, or null when none is saved. */
  demat: string | null;
  depository: 'NSDL' | 'CDSL' | null;
  holderName: string | null;
  isActive: boolean;
  createdAt: string;
}

export type AllotmentStatus = 'allotted' | 'not_allotted' | 'not_applied' | 'pending' | 'error';

export interface AllotmentResult {
  panId: string;
  label: string;
  panMasked: string;
  status: AllotmentStatus;
  appliedQty: number | null;
  allottedQty: number | null;
  amount: number | null;
  nameOnRecord: string | null;
  message: string | null;
  checkedAt: string;
}

export interface AllotmentSummary {
  ipoId: string;
  ipoName: string;
  registrar: string | null;
  totalAccounts: number;
  allottedAccounts: number;
  notAllottedAccounts: number;
  notAppliedAccounts: number;
  errorAccounts: number;
  totalShares: number;
  totalAmount: number;
  resultsLive: boolean;
  results: AllotmentResult[];
  checked: boolean;
  headline?: string;
}

export interface AllotmentHistoryRow {
  ipoId: string;
  ipoName: string;
  boaDate: string | null;
  logoUrl: string | null;
  category: string | null;
  totalAccounts: number;
  allottedAccounts: number;
  totalShares: number;
  totalAmount: number;
  checkedAt: string;
}

export interface AppNotification {
  id: string;
  ipoId: string | null;
  ipoName: string | null;
  logoUrl: string | null;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface AlertPrefs {
  account_id: string;
  ipo_open: number;
  ipo_closing: number;
  allotment_out: number;
  listing_day: number;
  gmp_moves: number;
  gmp_threshold: number;
  only_watchlist: number;
}

export type RefundStatus = 'blocked' | 'refund_pending' | 'refund_received' | 'debited';
export type ApplicationCategory = 'retail' | 'shni' | 'bhni';

export interface Application {
  id: string;
  ipoId: string;
  panId: string;
  label: string;
  panMasked: string;
  holderName: string | null;
  category: ApplicationCategory;
  lots: number;
  shares: number | null;
  amountBlocked: number | null;
  appliedAt: string;
  allottedShares: number | null;
  amountDebited: number | null;
  refundAmount: number | null;
  refundStatus: RefundStatus;
  settledAt: string | null;
  notes: string | null;
}

export interface ApplicationAccount {
  panId: string;
  label: string;
  panMasked: string;
  holderName: string | null;
  application: Application | null;
}

export interface ApplicationBoard {
  ipoId: string;
  ipoName: string;
  lotSize: number | null;
  cutoffPrice: number | null;
  amountPerLot: number | null;
  status: string | null;
  boaDate: string | null;
  accounts: ApplicationAccount[];
}

export interface MoneySummary {
  totalBlocked: number;
  refundPending: number;
  refundReceived: number;
  totalInvested: number;
  applicationCount: number;
  ipoCount: number;
}

export interface IpoMoneyRow {
  ipoId: string;
  ipoName: string;
  logoUrl: string | null;
  category: string | null;
  status: string | null;
  boaDate: string | null;
  listingDate: string | null;
  accounts: number;
  totalLots: number;
  amountBlocked: number;
  amountDebited: number;
  refundAmount: number;
  allottedShares: number;
  refundStatus: RefundStatus;
}
