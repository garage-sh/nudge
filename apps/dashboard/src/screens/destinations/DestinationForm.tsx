import {
  SEVERITIES,
  DESTINATION_TYPES,
  FEEDBACK_TYPES,
  type FilterInput,
  type FilterView,
  type Severity,
  type DestinationType,
  type FeedbackType,
} from '@nudge/shared';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useT } from '../../i18n/index.js';
import { ErrorMessage, Field, PanelHeader } from '../../layout/ui.js';
import { DESTINATION_FORMS, TypeIcon } from './types/index.js';

export interface DestinationValues {
  readonly type: DestinationType;
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly filter: FilterInput;
  /** Only the secrets typed in: missing, the saved ones are kept. */
  readonly secrets?: Record<string, string>;
}

/**
 * The form shared by every type: name, the type's fields, Filter. The type is chosen
 * only when adding (`typeEditable`); a Destination keeps it afterwards. The Instance's
 * Alert destination has neither name nor Filter (`withoutNameOrFilter`).
 */
export function DestinationForm({
  title,
  initial,
  typeEditable,
  savedSecrets = [],
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
  withoutNameOrFilter = false,
  children,
  actions,
  headingId,
  status,
}: {
  title: string;
  /** The title's `id`, for a link to the panel (Settings). */
  headingId?: string;
  /** The saved state, beside the title (`PanelHeader`). */
  status?: ReactNode;
  initial: Omit<DestinationValues, 'secrets' | 'filter'> & { readonly filter: FilterView };
  typeEditable: boolean;
  savedSecrets?: readonly string[];
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (values: DestinationValues) => void;
  onCancel?: () => void;
  withoutNameOrFilter?: boolean;
  /** Under the title: an introduction, a state. */
  children?: ReactNode;
  /** After the submit button: other actions (`type="button"` buttons). */
  actions?: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const [type, setType] = useState(initial.type);
  const [name, setName] = useState(initial.name);
  const [config, setConfig] = useState<Record<string, unknown>>({ ...initial.config });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<readonly FeedbackType[]>(initial.filter.types);
  const [minimumSeverity, setMinimumSeverity] = useState<Severity | null>(
    initial.filter.minimumSeverity,
  );
  const { Fields } = DESTINATION_FORMS[type];

  const changeType = (next: DestinationType) => {
    setType(next);
    setConfig({ ...DESTINATION_FORMS[next].initialConfig });
    setSecrets({});
  };
  const toggle = (feedbackType: FeedbackType) =>
    setTypes((current) =>
      current.includes(feedbackType)
        ? current.filter((other) => other !== feedbackType)
        : FEEDBACK_TYPES.filter((other) => other === feedbackType || current.includes(other)),
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value));
    onSubmit({
      type,
      name,
      config,
      filter: { types: [...types], minimumSeverity },
      ...(Object.keys(typed).length > 0 ? { secrets: typed } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="form panel" aria-label={title}>
      <PanelHeader id={headingId} title={title} status={status} />
      {children}
      {typeEditable ? (
        <fieldset className="field type-picker">
          <legend>{t.destinations.form.type}</legend>
          {DESTINATION_TYPES.map((value) => (
            <label key={value} className="type-option">
              <input
                type="radio"
                name={`${id}-type`}
                value={value}
                checked={type === value}
                onChange={() => changeType(value)}
              />
              <TypeIcon icon={DESTINATION_FORMS[value].icon} />
              {DESTINATION_FORMS[value].label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {withoutNameOrFilter ? null : (
        <Field
          label={t.destinations.form.name}
          id={`${id}-name`}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <Fields
        idPrefix={id}
        config={config}
        setConfig={setConfig}
        secrets={secrets}
        setSecrets={setSecrets}
        // Saved secrets are valid only for their type.
        savedSecrets={type === initial.type ? savedSecrets : []}
        purpose={withoutNameOrFilter ? 'alert' : 'feedback'}
      />
      {withoutNameOrFilter ? null : (
        <>
          <fieldset className="field">
            <legend>{t.destinations.form.acceptedTypes}</legend>
            {FEEDBACK_TYPES.map((feedbackType) => (
              <label key={feedbackType} className="check">
                <input
                  type="checkbox"
                  checked={types.includes(feedbackType)}
                  onChange={() => toggle(feedbackType)}
                />
                {t.labels.feedbackType[feedbackType]}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor={`${id}-severity`}>{t.destinations.form.minimumSeverity}</label>
            <select
              id={`${id}-severity`}
              value={minimumSeverity ?? ''}
              onChange={(e) => setMinimumSeverity((e.target.value || null) as Severity | null)}
            >
              <option value="">{t.destinations.form.noMinimum}</option>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {t.labels.severity[severity]}
                </option>
              ))}
            </select>
            <p className="help">{t.destinations.form.minimumSeverityHelp}</p>
          </div>
        </>
      )}
      <ErrorMessage error={error} />
      <div className="actions">
        <button type="submit" disabled={pending}>
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="ghost" onClick={onCancel}>
            {t.common.cancel}
          </button>
        ) : null}
        {actions}
      </div>
    </form>
  );
}
