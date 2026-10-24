import { GRAVITES, TYPES_RETOUR } from '@nudge/shared';
import { Field } from '../../../layout/ui.js';
import { LIBELLES_GRAVITE, LIBELLES_TYPE } from '../../../libelles.js';
import type { FormulaireTypeDestination } from './type-destination.js';

type Mapping = Readonly<Record<string, string>>;

interface ConfigSaisie {
  readonly equipe: string;
  readonly labels: { readonly types: Mapping; readonly gravites: Mapping };
}

const texte = (valeur: unknown): string => (typeof valeur === 'string' ? valeur : '');

const mapping = (valeur: unknown): Mapping =>
  valeur && typeof valeur === 'object'
    ? Object.fromEntries(
        Object.entries(valeur).filter(
          (entree): entree is [string, string] => typeof entree[1] === 'string',
        ),
      )
    : {};

/** La config telle qu'enregistrée, lue sans faire confiance à sa forme. */
function lire(config: Readonly<Record<string, unknown>>): ConfigSaisie {
  const labels = (config.labels ?? {}) as Record<string, unknown>;
  return {
    equipe: texte(config.equipe),
    labels: { types: mapping(labels.types), gravites: mapping(labels.gravites) },
  };
}

/** Un label vidé n'est plus envoyé : pas de label pour ce Type ou cette Gravité. */
function avecLabel(actuel: Mapping, cle: string, valeur: string): Mapping {
  const { [cle]: _retire, ...reste } = actuel;
  return valeur ? { ...reste, [cle]: valeur } : reste;
}

/**
 * Linear : la clé d'API personnelle est un secret, saisi sans jamais être réaffiché ;
 * l'équipe et les labels sont désignés comme on les lit dans Linear.
 */
export const formulaireLinear: FormulaireTypeDestination<'linear'> = {
  libelle: 'Linear',
  configInitiale: { equipe: '', labels: { types: {}, gravites: {} } },
  Champs: ({ idPrefixe, config, setConfig, secrets, setSecrets, secretsEnregistres }) => {
    const saisie = lire(config);
    const gardee = secretsEnregistres.includes('cleApi');
    const changerLabel = (famille: 'types' | 'gravites', cle: string, valeur: string) =>
      setConfig({
        ...saisie,
        labels: { ...saisie.labels, [famille]: avecLabel(saisie.labels[famille], cle, valeur) },
      });
    return (
      <>
        <Field
          libelle="Clé d’API"
          id={`${idPrefixe}-linear-cle`}
          type="password"
          autoComplete="off"
          required={!gardee}
          placeholder="lin_api_…"
          value={secrets.cleApi ?? ''}
          onChange={(e) => setSecrets({ ...secrets, cleApi: e.target.value })}
          aide={
            gardee
              ? 'Une clé est enregistrée (chiffrée) : laissez vide pour la garder.'
              : 'Linear › Paramètres › Sécurité et accès › Clés d’API personnelles. Stockée chiffrée, jamais réaffichée.'
          }
        />
        <Field
          libelle="Équipe"
          id={`${idPrefixe}-linear-equipe`}
          required
          placeholder="ENG"
          value={saisie.equipe}
          onChange={(e) => setConfig({ ...saisie, equipe: e.target.value })}
          aide="La clé de l’équipe : les lettres avant le numéro des issues (ENG dans ENG-123)."
        />
        <fieldset className="champ">
          <legend>Labels posés selon le Type</legend>
          {TYPES_RETOUR.map((type) => (
            <Field
              key={type}
              libelle={`Label du Type ${LIBELLES_TYPE[type]}`}
              id={`${idPrefixe}-linear-type-${type}`}
              value={saisie.labels.types[type] ?? ''}
              onChange={(e) => changerLabel('types', type, e.target.value)}
            />
          ))}
        </fieldset>
        <fieldset className="champ">
          <legend>Labels posés selon la Gravité</legend>
          {GRAVITES.map((gravite) => (
            <Field
              key={gravite}
              libelle={`Label de la Gravité ${LIBELLES_GRAVITE[gravite]}`}
              id={`${idPrefixe}-linear-gravite-${gravite}`}
              value={saisie.labels.gravites[gravite] ?? ''}
              onChange={(e) => changerLabel('gravites', gravite, e.target.value)}
            />
          ))}
          <p className="aide">
            Le nom du label tel qu’il s’affiche dans Linear, de l’équipe ou de l’espace de travail.
            Laissé vide : aucun label. Un label introuvable suspend la Destination.
          </p>
        </fieldset>
      </>
    );
  },
  resume: (config) => `Équipe ${lire(config).equipe}`,
  secretsGeneres: {},
};
