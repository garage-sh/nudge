import { Field } from '../../../layout/ui.js';
import type { FormulaireTypeDestination } from './type-destination.js';

const depot = (config: Readonly<Record<string, unknown>>) =>
  typeof config.depot === 'string' ? config.depot : '';

/**
 * GitHub Issues : le jeton d'accès est un secret, saisi sans jamais être réaffiché ;
 * le dépôt est désigné comme dans son URL (propriétaire/dépôt).
 */
export const formulaireGitHub: FormulaireTypeDestination<'github'> = {
  libelle: 'GitHub Issues',
  configInitiale: { depot: '' },
  Champs: ({ idPrefixe, config, setConfig, secrets, setSecrets, secretsEnregistres }) => {
    const gardee = secretsEnregistres.includes('jeton');
    return (
      <>
        <Field
          libelle="Jeton d’accès"
          id={`${idPrefixe}-github-jeton`}
          type="password"
          autoComplete="off"
          required={!gardee}
          placeholder="github_pat_…"
          value={secrets.jeton ?? ''}
          onChange={(e) => setSecrets({ ...secrets, jeton: e.target.value })}
          aide={
            gardee
              ? 'Un jeton est enregistré (chiffré) : laissez vide pour le garder.'
              : 'GitHub › Settings › Developer settings › Fine-grained tokens : limité à ce dépôt, permission Issues en lecture et écriture. Stocké chiffré, jamais réaffiché.'
          }
        />
        <Field
          libelle="Dépôt"
          id={`${idPrefixe}-github-depot`}
          required
          placeholder="organisation/depot"
          value={depot(config)}
          onChange={(e) => setConfig({ ...config, depot: e.target.value })}
          aide="Le propriétaire et le nom du dépôt, comme dans son URL : github.com/organisation/depot."
        />
      </>
    );
  },
  resume: (config) => `Dépôt ${depot(config)}`,
  secretsGeneres: {},
};
