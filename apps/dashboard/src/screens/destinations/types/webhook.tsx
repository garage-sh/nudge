import { Field } from '../../../layout/ui.js';
import type { FormulaireTypeDestination } from './type-destination.js';

const url = (config: Readonly<Record<string, unknown>>) =>
  typeof config.url === 'string' ? config.url : '';

export const formulaireWebhook: FormulaireTypeDestination<'webhook'> = {
  libelle: 'Webhook',
  configInitiale: { url: '' },
  Champs: ({ idPrefixe, config, setConfig }) => (
    <Field
      libelle="URL"
      id={`${idPrefixe}-url`}
      type="url"
      required
      placeholder="https://exemple.com/nudge"
      value={url(config)}
      onChange={(e) => setConfig({ ...config, url: e.target.value })}
      aide="nudge y POSTe chaque Retour en JSON, signé : X-Nudge-Signature vaut sha256=HMAC(secret, X-Nudge-Timestamp + « . » + corps)."
    />
  ),
  resume: url,
  secretsGeneres: {
    secretSignature: {
      libelle: 'Secret de signature',
      aide: 'Votre récepteur vérifie avec lui que les appels viennent de cette Instance.',
    },
  },
};
