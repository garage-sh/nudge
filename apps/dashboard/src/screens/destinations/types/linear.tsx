import { SEVERITIES, FEEDBACK_TYPES } from '@nudge/shared';
import { useT } from '../../../i18n/index.js';
import { Field } from '../../../layout/ui.js';
import type { DestinationTypeForm, TypeFieldsProps } from './destination-type-form.js';

type Mapping = Readonly<Record<string, string>>;

interface ConfigInput {
  readonly team: string;
  readonly labels: { readonly types: Mapping; readonly severities: Mapping };
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const mapping = (value: unknown): Mapping =>
  value && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

/** The config as saved, read without trusting its shape. */
function read(config: Readonly<Record<string, unknown>>): ConfigInput {
  const labels = (config.labels ?? {}) as Record<string, unknown>;
  return {
    team: text(config.team),
    labels: { types: mapping(labels.types), severities: mapping(labels.severities) },
  };
}

/** A cleared label is no longer sent: no label for this type or Severity. */
function withLabel(current: Mapping, key: string, value: string): Mapping {
  const { [key]: _removed, ...rest } = current;
  return value ? { ...rest, [key]: value } : rest;
}

/**
 * Linear: the personal API key is a secret, typed in and never shown again; the team
 * and the labels are named as they read in Linear.
 */
function LinearFields({
  idPrefix,
  config,
  setConfig,
  secrets,
  setSecrets,
  savedSecrets,
}: TypeFieldsProps) {
  const t = useT();
  const l = t.destinationTypes.linear;
  const input = read(config);
  const kept = savedSecrets.includes('apiKey');
  const changeLabel = (family: 'types' | 'severities', key: string, value: string) =>
    setConfig({
      ...input,
      labels: { ...input.labels, [family]: withLabel(input.labels[family], key, value) },
    });
  return (
    <>
      <Field
        label={l.apiKey}
        id={`${idPrefix}-linear-key`}
        type="password"
        autoComplete="off"
        required={!kept}
        placeholder="lin_api_…"
        value={secrets.apiKey ?? ''}
        onChange={(e) => setSecrets({ ...secrets, apiKey: e.target.value })}
        help={kept ? t.destinationTypes.savedKey : l.apiKeyHelp}
      />
      <Field
        label={l.team}
        id={`${idPrefix}-linear-team`}
        required
        placeholder="ENG"
        value={input.team}
        onChange={(e) => setConfig({ ...input, team: e.target.value })}
        help={l.teamHelp}
      />
      <fieldset className="field">
        <legend>{l.typeLabels}</legend>
        {FEEDBACK_TYPES.map((type) => (
          <Field
            key={type}
            label={l.typeLabel(t.labels.feedbackType[type])}
            id={`${idPrefix}-linear-type-${type}`}
            value={input.labels.types[type] ?? ''}
            onChange={(e) => changeLabel('types', type, e.target.value)}
          />
        ))}
      </fieldset>
      <fieldset className="field">
        <legend>{l.severityLabels}</legend>
        {SEVERITIES.map((severity) => (
          <Field
            key={severity}
            label={l.severityLabel(t.labels.severity[severity])}
            id={`${idPrefix}-linear-severity-${severity}`}
            value={input.labels.severities[severity] ?? ''}
            onChange={(e) => changeLabel('severities', severity, e.target.value)}
          />
        ))}
        <p className="help">{l.labelsHelp}</p>
      </fieldset>
    </>
  );
}

export const linearForm: DestinationTypeForm<'linear'> = {
  label: 'Linear',
  initialConfig: { team: '', labels: { types: {}, severities: {} } },
  Fields: LinearFields,
  summary: (config, t) => t.destinationTypes.linear.summary(read(config).team),
  generatedSecrets: {},
};
