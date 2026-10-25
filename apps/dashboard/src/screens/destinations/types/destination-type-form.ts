import type { DESTINATION_DEFINITIONS, DestinationType } from '@nudge/shared';
import type { ReactNode } from 'react';
import type { Messages } from '../../../i18n/index.js';
import type { TypeIconShape } from './type-icon.js';

/** What the shared form passes to a type's own fields. */
export interface TypeFieldsProps {
  /** Prefix of the fields' `id`s: several forms coexist on the screen. */
  readonly idPrefix: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly setConfig: (config: Record<string, unknown>) => void;
  /** Secrets typed in this form; a missing key keeps the saved secret. */
  readonly secrets: Readonly<Record<string, string>>;
  readonly setSecrets: (secrets: Record<string, string>) => void;
  /** Names of the secrets already saved (encrypted, never returned by the api). */
  readonly savedSecrets: readonly string[];
  /** What the Destination receives: a Project's Feedback, or the Instance's alerts. */
  readonly purpose: 'feedback' | 'alert';
}

/**
 * The dashboard side of a Destination type. Each type (`webhook.tsx`…) exports one,
 * registered in `DESTINATION_FORMS` (`index.ts`).
 */
export interface DestinationTypeForm<T extends DestinationType = DestinationType> {
  /** The type's name: a product name, the same in every locale. */
  readonly label: string;
  /** The type's mark, beside its name in the type picker and the lists. */
  readonly icon: TypeIconShape;
  /** Configuration of a new Destination of this type. */
  readonly initialConfig: Readonly<Record<string, unknown>>;
  /** The type's own config and secret fields. */
  readonly Fields: (props: TypeFieldsProps) => ReactNode;
  /** The config summed up in the list (a URL, a channel…), shown as text. */
  readonly summary: (config: Readonly<Record<string, unknown>>, t: Messages) => string;
  /** Label and use of each secret the Instance generates, shown once. */
  readonly generatedSecrets: Readonly<
    Record<
      (typeof DESTINATION_DEFINITIONS)[T]['generatedSecrets'][number],
      (t: Messages) => { label: string; help: string }
    >
  >;
}
