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

export interface AllotmentQuery {
  companyCode: string;
  pan: string;
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
