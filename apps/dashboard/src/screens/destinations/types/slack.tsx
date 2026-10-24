import { Field } from '../../../layout/ui.js';
import type { FormulaireTypeDestination } from './type-destination.js';

/** L'URL du webhook entrant porte son jeton : un secret, saisi sans jamais être réaffiché. */
export const formulaireSlack: FormulaireTypeDestination<'slack'> = {
  libelle: 'Slack',
  configInitiale: {},
  Champs: ({ idPrefixe, secrets, setSecrets, secretsEnregistres }) => {
    const gardee = secretsEnregistres.includes('url');
    return (
      <Field
        libelle="URL du webhook"
        id={`${idPrefixe}-slack-url`}
        type="password"
        autoComplete="off"
        required={!gardee}
        placeholder="https://hooks.slack.com/services/…"
        value={secrets.url ?? ''}
        onChange={(e) => setSecrets({ ...secrets, url: e.target.value })}
        aide={
          gardee
            ? 'Une URL est enregistrée (chiffrée) : laissez vide pour la garder.'
            : 'Votre app Slack › Incoming Webhooks › Add New Webhook, puis choisir le canal. Stockée chiffrée, jamais réaffichée.'
        }
      />
    );
  },
  resume: () => 'Webhook entrant',
  secretsGeneres: {},
};
