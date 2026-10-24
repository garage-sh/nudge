import { Field } from '../../../layout/ui.js';
import type { FormulaireTypeDestination } from './type-destination.js';

/** L'URL du webhook porte son jeton : un secret, saisi sans jamais être réaffiché. */
export const formulaireDiscord: FormulaireTypeDestination<'discord'> = {
  libelle: 'Discord',
  configInitiale: {},
  Champs: ({ idPrefixe, secrets, setSecrets, secretsEnregistres }) => {
    const gardee = secretsEnregistres.includes('url');
    return (
      <Field
        libelle="URL du webhook"
        id={`${idPrefixe}-discord-url`}
        type="password"
        autoComplete="off"
        required={!gardee}
        placeholder="https://discord.com/api/webhooks/…"
        value={secrets.url ?? ''}
        onChange={(e) => setSecrets({ ...secrets, url: e.target.value })}
        aide={
          gardee
            ? 'Une URL est enregistrée (chiffrée) : laissez vide pour la garder.'
            : 'Paramètres du salon › Intégrations › Webhooks › Copier l’URL. Stockée chiffrée, jamais réaffichée.'
        }
      />
    );
  },
  resume: () => 'Webhook de salon',
  secretsGeneres: {},
};
