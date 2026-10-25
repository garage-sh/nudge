import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
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
    <div className="loading" aria-live="polite">
      <span className="visually-hidden">{t.common.loading}</span>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
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
  title: ReactNode;
  back?: { to: string; label: string };
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {back ? (
          <Link to={back.to} className="back-link">
            ← {back.label}
          </Link>
        ) : null}
        <h1>{title}</h1>
        {description ? <p className="description">{description}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
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

export function Field({ label, help, id, ...input }: FieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} {...input} />
      {help ? <p className="help">{help}</p> : null}
    </div>
  );
}

/**
 * A key or a link shown in full, with a copy button. Without a clipboard (http origin,
 * refused by the browser), the text is selected for a manual copy.
 */
export function CopyableValue({ value, label }: { value: string; label: string }) {
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
  return (
    <div className="copyable">
      <code ref={code} aria-label={label}>
        {value}
      </code>
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
  question,
  pending,
  onConfirm,
}: {
  label: string;
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
      <button ref={trigger} type="button" className="secondary" onClick={() => setOpen(true)}>
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
