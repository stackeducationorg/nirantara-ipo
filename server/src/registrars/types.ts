export type AllotmentStatus =
  | 'allotted'      // shares were allotted
  | 'not_allotted'  // applied, but got nothing
  | 'not_applied'   // registrar has no record for this PAN
  | 'pending'       // allotment not published yet
  | 'error';        // lookup failed (network, bot wall, bad company code)

export interface RegistrarCompany {
  /** The registrar's own identifier for the issue — needed for every lookup. */
  code: string;
  name: string;
}

export type Depository = 'NSDL' | 'CDSL';

/**
 * A demat account, stored in the form the registrars expect:
 *   NSDL — "IN" followed by 14 digits
 *   CDSL — 16 digits
 * Registrars that split it (Bigshare wants DP ID and Client ID separately) slice it themselves.
 */
export interface DematAccount {
  depository: Depository;
  id: string;
}

export type SearchBy = 'pan' | 'demat';

export interface AllotmentQuery {
  companyCode: string;
  pan: string;
  /** Set when the saved applicant also has a demat account on file. */
  demat?: DematAccount | null;
  /** Which identifier to look up by. Defaults to `pan`. */
  by?: SearchBy;
}

export interface AllotmentLookup {
  status: AllotmentStatus;
  appliedQty?: number | null;
  allottedQty?: number | null;
  nameOnRecord?: string | null;
  applicationNo?: string | null;
  message?: string | null;
  raw?: unknown;
}

export interface RegistrarAdapter {
  /** Stable key stored on the ipos row. */
  key: string;
  /** Display name shown in the UI. */
  name: string;
  /** `http` adapters are cheap; `browser` adapters drive Playwright and are rate-limited. */
  driver: 'http' | 'browser';
  /** Hostname fragments that identify this registrar on an IPO detail page. */
  match: string[];
  /**
   * Identifier kinds this registrar can search by. Every registrar accepts a PAN; only some
   * accept a demat account, so this is what stops a demat lookup being sent somewhere that
   * would silently answer "not applied" instead of admitting it cannot search that way.
   */
  searchBy: SearchBy[];
  /** The issues this registrar currently has open for allotment lookup. */
  listCompanies(): Promise<RegistrarCompany[]>;
  check(query: AllotmentQuery): Promise<AllotmentLookup>;
}

export class RegistrarError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'RegistrarError';
  }
}
