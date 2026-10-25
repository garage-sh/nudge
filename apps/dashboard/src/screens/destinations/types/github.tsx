import { useT } from '../../../i18n/index.js';
import { Field } from '../../../layout/ui.js';
import type { DestinationTypeForm, TypeFieldsProps } from './destination-type-form.js';

const repository = (config: Readonly<Record<string, unknown>>) =>
  typeof config.repository === 'string' ? config.repository : '';

/**
 * GitHub Issues: the access token is a secret, typed in and never shown again; the
 * repository is named as in its URL (owner/repository).
 */
function GitHubFields({
  idPrefix,
  config,
  setConfig,
  secrets,
  setSecrets,
  savedSecrets,
}: TypeFieldsProps) {
  const t = useT();
  const kept = savedSecrets.includes('token');
  return (
    <>
      <Field
        label={t.destinationTypes.github.token}
        id={`${idPrefix}-github-token`}
        type="password"
        autoComplete="off"
        required={!kept}
        placeholder="github_pat_…"
        value={secrets.token ?? ''}
        onChange={(e) => setSecrets({ ...secrets, token: e.target.value })}
        help={kept ? t.destinationTypes.savedToken : t.destinationTypes.github.tokenHelp}
      />
      <Field
        label={t.destinationTypes.github.repository}
        id={`${idPrefix}-github-repository`}
        required
        placeholder={t.destinationTypes.github.repositoryPlaceholder}
        value={repository(config)}
        onChange={(e) => setConfig({ ...config, repository: e.target.value })}
        help={t.destinationTypes.github.repositoryHelp}
      />
    </>
  );
}

export const gitHubForm: DestinationTypeForm<'github'> = {
  label: 'GitHub Issues',
  initialConfig: { repository: '' },
  Fields: GitHubFields,
  summary: (config, t) => t.destinationTypes.github.summary(repository(config)),
  generatedSecrets: {},
};
