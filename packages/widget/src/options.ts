import type { Locale } from './locales/index.js';

/**
 * The Author's identity as the host app knows it (signed-in user).
 * Coming from the browser, the Instance records it as *declared*, never attested.
 */
export interface DeclaredAuthor {
  readonly id?: string;
  readonly email?: string;
  readonly name?: string;
}

/** Free-form host metadata (version, environment…), attached to the Feedback context. */
export type Metadata = Readonly<Record<string, string | number | boolean | null>>;

/** What the integrator gives the Widget. */
export interface WidgetOptions {
  /** The Project's public key (`nk_pub_…`). */
  readonly publicKey: string;
  /** Address of the nudge Instance (`https://nudge.example`). */
  readonly api: string;
  readonly author?: DeclaredAuthor;
  readonly metadata?: Metadata;
  /** The Widget's language; detected from the page, then the browser, when omitted. */
  readonly locale?: Locale;
}
