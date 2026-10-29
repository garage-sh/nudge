import {
  SEVERITIES,
  DESTINATION_TYPES,
  FEEDBACK_TYPES,
  FILTER_ALL,
  INCIDENT_FILTER_ALL,
  LEVELS,
  type FilterInput,
  type FilterView,
  type IncidentFilterInput,
  type IncidentFilterView,
  type Level,
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
  /** `null`: the Feedback Filter is off. */
  readonly filter: FilterInput | null;
  /** `null`: the Incident Filter is off. */
  readonly incidentFilter: IncidentFilterInput | null;
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
  initial: Omit<DestinationValues, 'secrets' | 'filter' | 'incidentFilter'> & {
    readonly filter: FilterView | null;
    readonly incidentFilter?: IncidentFilterView | null;
  };
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
  const [feedbackOn, setFeedbackOn] = useState(initial.filter !== null);
  const [types, setTypes] = useState<readonly FeedbackType[]>((initial.filter ?? FILTER_ALL).types);
  const [minimumSeverity, setMinimumSeverity] = useState<Severity | null>(
    (initial.filter ?? FILTER_ALL).minimumSeverity,
  );
  const [incidentFilter, setIncidentFilter] = useState<IncidentFilterDraft>(() =>
    draftOf(initial.incidentFilter ?? null),
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
      filter: feedbackOn ? { types: [...types], minimumSeverity } : null,
      incidentFilter: incidentFilterOf(incidentFilter),
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
        <fieldset className="filter-group">
          <legend>{t.destinations.form.feedbackFilter}</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={feedbackOn}
              onChange={(e) => setFeedbackOn(e.target.checked)}
            />
            {t.destinations.form.feedbackFilterOn}
          </label>
          {feedbackOn ? (
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
          ) : null}
        </fieldset>
      )}
      {withoutNameOrFilter ? null : (
        <IncidentFilterFields
          idPrefix={`${id}-incident`}
          draft={incidentFilter}
          onChange={setIncidentFilter}
        />
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

/** The Incident Filter as the form edits it: lists typed as comma-separated text. */
interface IncidentFilterDraft {
  readonly on: boolean;
  readonly minimumLevel: Level;
  readonly environments: string;
  readonly conditions: readonly { readonly key: string; readonly values: string }[];
}

const draftOf = (filter: IncidentFilterView | null): IncidentFilterDraft => {
  const { minimumLevel, environments, conditions } = filter ?? INCIDENT_FILTER_ALL;
  return {
    on: filter !== null,
    minimumLevel,
    environments: environments.join(', '),
    conditions: conditions.map(({ key, values }) => ({ key, values: values.join(', ') })),
  };
};

/** Comma-separated text to a list; blanks dropped (the api validates the rest). */
const listOf = (text: string): string[] =>
  text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const incidentFilterOf = (draft: IncidentFilterDraft): IncidentFilterInput | null =>
  draft.on
    ? {
        minimumLevel: draft.minimumLevel,
        environments: listOf(draft.environments),
        // A row left empty is no condition.
        conditions: draft.conditions
          .filter(({ key, values }) => key.trim() || values.trim())
          .map(({ key, values }) => ({ key: key.trim(), values: listOf(values) })),
      }
    : null;

/**
 * The Incident Filter: off, or minimum Level, accepted Environments and context
 * conditions "key is one of these values", all required.
 */
function IncidentFilterFields({
  idPrefix,
  draft,
  onChange,
}: {
  idPrefix: string;
  draft: IncidentFilterDraft;
  onChange: (draft: IncidentFilterDraft) => void;
}) {
  const t = useT();
  const f = t.destinations.form;
  const set = (fields: Partial<IncidentFilterDraft>) => onChange({ ...draft, ...fields });
  const setCondition = (
    index: number,
    fields: Partial<IncidentFilterDraft['conditions'][number]>,
  ) =>
    set({
      conditions: draft.conditions.map((condition, other) =>
        other === index ? { ...condition, ...fields } : condition,
      ),
    });
  return (
    <fieldset className="filter-group">
      <legend>{f.incidentFilter}</legend>
      <label className="check">
        <input type="checkbox" checked={draft.on} onChange={(e) => set({ on: e.target.checked })} />
        {f.incidentFilterOn}
      </label>
      {draft.on ? (
        <>
          <div className="field">
            <label htmlFor={`${idPrefix}-level`}>{f.minimumLevel}</label>
            <select
              id={`${idPrefix}-level`}
              value={draft.minimumLevel}
              onChange={(e) => set({ minimumLevel: e.target.value as Level })}
            >
              {LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t.labels.level[level]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-environments`}>{f.environments}</label>
            <input
              id={`${idPrefix}-environments`}
              value={draft.environments}
              placeholder="production, staging"
              aria-describedby={`${idPrefix}-environments-help`}
              onChange={(e) => set({ environments: e.target.value })}
            />
            <p className="help" id={`${idPrefix}-environments-help`}>
              {f.environmentsHelp}
            </p>
          </div>
          <fieldset className="field conditions-field">
            <legend>{f.conditions}</legend>
            <p className="help">{f.conditionsHelp}</p>
            {draft.conditions.length === 0 ? <p className="muted">{f.noCondition}</p> : null}
            <ul className="conditions">
              {draft.conditions.map((condition, index) => (
                <li key={index} className="condition">
                  <div className="field">
                    <label htmlFor={`${idPrefix}-key-${index}`}>{f.conditionKey}</label>
                    <input
                      id={`${idPrefix}-key-${index}`}
                      value={condition.key}
                      placeholder="service"
                      onChange={(e) => setCondition(index, { key: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${idPrefix}-values-${index}`}>{f.conditionValues}</label>
                    <input
                      id={`${idPrefix}-values-${index}`}
                      value={condition.values}
                      placeholder="checkout, billing"
                      aria-describedby={`${idPrefix}-values-help`}
                      onChange={(e) => setCondition(index, { values: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`${f.removeCondition} ${condition.key || f.conditionKey}`}
                    onClick={() =>
                      set({ conditions: draft.conditions.filter((_, other) => other !== index) })
                    }
                  >
                    {f.removeCondition}
                  </button>
                </li>
              ))}
            </ul>
            {draft.conditions.length > 0 ? (
              <p className="help" id={`${idPrefix}-values-help`}>
                {f.conditionValuesHelp}
              </p>
            ) : null}
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => set({ conditions: [...draft.conditions, { key: '', values: '' }] })}
              >
                {f.addCondition}
              </button>
            </div>
          </fieldset>
        </>
      ) : (
        <p className="help">{f.incidentFilterOff}</p>
      )}
    </fieldset>
  );
}
