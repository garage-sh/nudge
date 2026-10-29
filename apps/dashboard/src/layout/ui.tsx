import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'react-router';
import { ApiError } from '../api/client.js';
import { useT, type Messages } from '../i18n/index.js';

/** True while the media query matches; false where `matchMedia` does not exist. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}

/** A readable message for an API error (known code, details of refused fields) or a network one. */
export function errorMessage(error: unknown, t: Messages): string {
  if (!(error instanceof ApiError)) return t.unreachable;
  if (error.code === 'invalid_request' && error.body.details?.length) {
    return error.body.details.map((detail) => detail.message).join(' ');
  }
  const known: Readonly<Record<string, string | undefined>> = t.apiErrors;
  return known[error.code] ?? t.unexpectedError(error.code);
}

/** The error, in plain words; `onRetry` adds "Retry" (a read that failed). */
export function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  if (!error) return null;
  return (
    <p role="alert" className="alert">
      <span>{errorMessage(error, t)}</span>
      {onRetry ? (
        <button type="button" className="secondary" onClick={onRetry}>
          {t.common.retry}
        </button>
      ) : null}
    </p>
  );
}

/**
 * "Saved.", announced: an always-present `status` region, filled after a successful
 * save. The form clears it as soon as it changes (the mutation's `reset`).
 */
export function SaveStatus({ saved }: { saved: boolean }) {
  const t = useT();
  return (
    <p role="status" className="save-status">
      {saved ? t.common.saved : ''}
    </p>
  );
}

/** Loading: row skeletons, announced as "Loading…". */
export function Loading() {
  const t = useT();
  return (
    <div className="loading" role="status">
      <span className="visually-hidden">{t.common.loading}</span>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

/** The browser tab names the screen: "Members · nudge". */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · nudge`;
    return () => {
      document.title = 'nudge';
    };
  }, [title]);
}

/**
 * A screen's header: the title (the screen's only `h1`), an optional back link above
 * it, a description, and the screen's actions on the right.
 */
export function PageHeader({
  title,
  back,
  description,
  actions,
}: {
  title: string;
  back?: { to: string; label: string };
  description?: ReactNode;
  actions?: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <header className="page-header">
      <div>
        {back ? (
          <Link to={back.to} className="back-link">
            <span aria-hidden="true">←</span> {back.label}
          </Link>
        ) : null}
        <h1>{title}</h1>
        {description ? <p className="description">{description}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}

/**
 * A panel's title, with the saved state of what it configures on the right (a `Pill`):
 * readable at a glance before reading the form.
 */
export function PanelHeader({
  id,
  title,
  status,
}: {
  id?: string;
  title: string;
  status?: ReactNode;
}) {
  return (
    <div className="panel-header">
      <h2 id={id}>{title}</h2>
      {status}
    </div>
  );
}

/** Nothing to show: say why and, when there is one, offer the action that fills the screen. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <p>
        <strong>{title}</strong>
      </p>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/** A pill's tone: the semantic color of a state (see docs/design-system.md). */
export type Tone = 'neutral' | 'success' | 'review' | 'danger' | 'held' | 'off';

/** A State or a Status, as a pill colored by its tone. */
export function Pill({
  tone,
  children,
  title,
}: {
  tone: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge pill tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; help?: ReactNode };

/** Why the browser refuses a field's value, in the dashboard's language. */
function validityMessage(input: HTMLInputElement, t: Messages): string {
  const { validity } = input;
  const v = t.validation;
  if (validity.valueMissing) return v.required;
  if (validity.typeMismatch) {
    if (input.type === 'email') return v.email;
    if (input.type === 'url') return v.url;
  }
  if (validity.tooShort) return v.tooShort(input.minLength);
  if (validity.tooLong) return v.tooLong(input.maxLength);
  if (validity.rangeUnderflow) return v.min(input.min);
  if (validity.rangeOverflow) return v.max(input.max);
  if (validity.stepMismatch || validity.badInput) return v.wholeNumber;
  return v.invalid;
}

/**
 * A text field with its label and help. A value the browser refuses (required, email,
 * length, range) is said under the field rather than in the browser's bubble, and the
 * first refused field takes focus; the message follows the value until it is valid.
 */
export function Field({
  label,
  help,
  id,
  onInvalid,
  onChange,
  'aria-describedby': describedBy,
  ...input
}: FieldProps) {
  const t = useT();
  const generated = useId();
  const fieldId = id ?? generated;
  const [error, setError] = useState<string | null>(null);
  const helpId = `${fieldId}-help`;
  const errorId = `${fieldId}-error`;
  const descriptions = [describedBy, help ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={descriptions || undefined}
        onInvalid={(e) => {
          e.preventDefault();
          const field = e.currentTarget;
          setError(validityMessage(field, t));
          if (field.form?.querySelector(':invalid') === field) field.focus();
          onInvalid?.(e);
        }}
        onChange={(e) => {
          const field = e.currentTarget;
          if (error) setError(field.validity.valid ? null : validityMessage(field, t));
          onChange?.(e);
        }}
        {...input}
      />
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
      {help ? (
        <p id={helpId} className="help">
          {help}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A key or a link shown in full, with a copy button. Without a clipboard (http origin,
 * refused by the browser), the text is selected for a manual copy. `multiline`: a
 * block of code (a JSON body, a snippet), whitespace kept, the button in its corner.
 */
export function CopyableValue({
  value,
  label,
  multiline = false,
}: {
  value: string;
  label: string;
  multiline?: boolean;
}) {
  const t = useT();
  const code = useRef<HTMLElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  useEffect(() => {
    if (state !== 'copied') return;
    const timeout = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timeout);
  }, [state]);
  const select = () => {
    const element = code.current;
    const selection = window.getSelection();
    if (!element || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      select();
      setState('manual');
    }
  };
  const text = (
    <code ref={code} aria-label={label}>
      {value}
    </code>
  );
  return (
    <div className={multiline ? 'copyable multiline' : 'copyable'}>
      {multiline ? <pre>{text}</pre> : text}
      <button type="button" className="secondary" onClick={() => void copy()}>
        {state === 'copied' ? t.common.copied : t.common.copy}
      </button>
      <span role="status" className={state === 'manual' ? 'help' : 'visually-hidden'}>
        {state === 'copied'
          ? t.common.copiedToClipboard
          : state === 'manual'
            ? t.common.copyManually
            : ''}
      </span>
    </div>
  );
}

/**
 * Returns focus to a button when what it opened (a form, an edit) closes: `open`
 * goes from true to false. Returns the ref to put on that button.
 */
export function useReturnFocus(open: boolean) {
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return button;
}

/**
 * The question of an in-place confirmation, with Confirm and Cancel. Focus goes to
 * Cancel (the safe choice); Escape cancels.
 */
export function Confirmation({
  question,
  pending,
  onConfirm,
  onCancel,
}: {
  question: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div
      className="confirmation"
      role="group"
      aria-label={question}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // Escape closes the confirmation, not what surrounds it (a Feedback's pane).
        e.stopPropagation();
        onCancel();
      }}
    >
      <span>{question}</span>
      <button type="button" className="danger" disabled={pending} onClick={onConfirm}>
        {t.common.confirm}
      </button>
      <button ref={cancel} type="button" className="secondary" onClick={onCancel}>
        {t.common.cancel}
      </button>
    </div>
  );
}

/**
 * An irreversible action in two steps: the button asks for an in-place confirmation.
 * Once closed, the confirmation returns focus to the original button.
 */
export function ConfirmAction({
  label,
  accessibleLabel,
  question,
  pending,
  onConfirm,
}: {
  label: string;
  /** The button's name for assistive technologies, when `label` alone is ambiguous in a list. */
  accessibleLabel?: string;
  question: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const shouldReturnFocus = useRef(false);
  useEffect(() => {
    if (!open && shouldReturnFocus.current) {
      shouldReturnFocus.current = false;
      trigger.current?.focus();
    }
  }, [open]);
  const close = () => {
    shouldReturnFocus.current = true;
    setOpen(false);
  };
  if (!open) {
    return (
      <button
        ref={trigger}
        type="button"
        className="secondary"
        aria-label={accessibleLabel}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <Confirmation
      question={question}
      pending={pending}
      onCancel={close}
      onConfirm={() => {
        close();
        onConfirm();
      }}
    />
  );
}

const isHttp = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * A URL from outside (a Feedback's context, a Delivery's link): a link only for
 * http(s), text otherwise — a `javascript:` URL never becomes clickable.
 */
export function ExternalLink({ href }: { href: string }) {
  if (!isHttp(href)) return <span className="raw-link">{href}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="raw-link">
      {href}
    </a>
  );
}

/** A list of label / value pairs (`.properties`), values rendered as text. */
export function Properties({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="properties">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A link to a panel (`/settings#settings-smtp`, `/projects/:id#project-incidents`)
 * lands on it once the panels are drawn: the router does not scroll to a hash by itself.
 */
export function useScrollToHash(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [ready, hash]);
}
