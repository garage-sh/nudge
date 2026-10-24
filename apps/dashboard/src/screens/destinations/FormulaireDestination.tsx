import {
  GRAVITES,
  TYPES_DESTINATION,
  TYPES_RETOUR,
  type FiltreSaisi,
  type FiltreVu,
  type Gravite,
  type TypeDestination,
  type TypeRetour,
} from '@nudge/shared';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ErrorMessage, Field } from '../../layout/ui.js';
import { LIBELLES_GRAVITE, LIBELLES_TYPE } from '../../libelles.js';
import { FORMULAIRES_DESTINATION } from './types/index.js';

export interface ValeursDestination {
  readonly type: TypeDestination;
  readonly nom: string;
  readonly config: Record<string, unknown>;
  readonly filtre: FiltreSaisi;
  /** Seulement les secrets saisis : absents, ceux enregistrés sont gardés. */
  readonly secrets?: Record<string, string>;
}

/**
 * Formulaire commun à tous les types : nom, champs du type, Filtre. Le type ne se
 * choisit qu'à l'ajout (`typeModifiable`) ; une Destination le garde ensuite. La
 * Destination d'alerte de l'Instance n'a ni nom ni Filtre (`sansNomNiFiltre`).
 */
export function FormulaireDestination({
  titre,
  initiales,
  typeModifiable,
  secretsEnregistres = [],
  libelleBouton,
  enCours,
  erreur,
  onSubmit,
  onAnnuler,
  sansNomNiFiltre = false,
  children,
  actions,
}: {
  titre: string;
  initiales: Omit<ValeursDestination, 'secrets' | 'filtre'> & { readonly filtre: FiltreVu };
  typeModifiable: boolean;
  secretsEnregistres?: readonly string[];
  libelleBouton: string;
  enCours: boolean;
  erreur: unknown;
  onSubmit: (valeurs: ValeursDestination) => void;
  onAnnuler?: () => void;
  sansNomNiFiltre?: boolean;
  /** Sous le titre : une présentation, un état. */
  children?: ReactNode;
  /** Après le bouton d'envoi : d'autres actions (boutons `type="button"`). */
  actions?: ReactNode;
}) {
  const id = useId();
  const [type, setType] = useState(initiales.type);
  const [nom, setNom] = useState(initiales.nom);
  const [config, setConfig] = useState<Record<string, unknown>>({ ...initiales.config });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<readonly TypeRetour[]>(initiales.filtre.types);
  const [graviteMinimale, setGraviteMinimale] = useState<Gravite | null>(
    initiales.filtre.graviteMinimale,
  );
  const { Champs } = FORMULAIRES_DESTINATION[type];

  const changerType = (nouveau: TypeDestination) => {
    setType(nouveau);
    setConfig({ ...FORMULAIRES_DESTINATION[nouveau].configInitiale });
    setSecrets({});
  };
  const basculer = (typeRetour: TypeRetour) =>
    setTypes((actuels) =>
      actuels.includes(typeRetour)
        ? actuels.filter((t) => t !== typeRetour)
        : TYPES_RETOUR.filter((t) => t === typeRetour || actuels.includes(t)),
    );
  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    const saisis = Object.fromEntries(Object.entries(secrets).filter(([, valeur]) => valeur));
    onSubmit({
      type,
      nom,
      config,
      filtre: { types: [...types], graviteMinimale },
      ...(Object.keys(saisis).length > 0 ? { secrets: saisis } : {}),
    });
  };

  return (
    <form onSubmit={soumettre} className="formulaire encadre" aria-label={titre}>
      <h2>{titre}</h2>
      {children}
      {typeModifiable ? (
        <div className="champ">
          <label htmlFor={`${id}-type`}>Type</label>
          <select
            id={`${id}-type`}
            value={type}
            onChange={(e) => changerType(e.target.value as TypeDestination)}
          >
            {TYPES_DESTINATION.map((valeur) => (
              <option key={valeur} value={valeur}>
                {FORMULAIRES_DESTINATION[valeur].libelle}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {sansNomNiFiltre ? null : (
        <Field
          libelle="Nom"
          id={`${id}-nom`}
          required
          value={nom}
          onChange={(e) => setNom(e.target.value)}
        />
      )}
      <Champs
        idPrefixe={id}
        config={config}
        setConfig={setConfig}
        secrets={secrets}
        setSecrets={setSecrets}
        // Les secrets enregistrés ne valent que pour leur type.
        secretsEnregistres={type === initiales.type ? secretsEnregistres : []}
      />
      {sansNomNiFiltre ? null : (
        <>
          <fieldset className="champ">
            <legend>Types retenus</legend>
            {TYPES_RETOUR.map((typeRetour) => (
              <label key={typeRetour} className="case">
                <input
                  type="checkbox"
                  checked={types.includes(typeRetour)}
                  onChange={() => basculer(typeRetour)}
                />
                {LIBELLES_TYPE[typeRetour]}
              </label>
            ))}
          </fieldset>
          <div className="champ">
            <label htmlFor={`${id}-gravite`}>Gravité minimale</label>
            <select
              id={`${id}-gravite`}
              value={graviteMinimale ?? ''}
              onChange={(e) => setGraviteMinimale((e.target.value || null) as Gravite | null)}
            >
              <option value="">Aucune</option>
              {GRAVITES.map((gravite) => (
                <option key={gravite} value={gravite}>
                  {LIBELLES_GRAVITE[gravite]}
                </option>
              ))}
            </select>
            <p className="aide">
              Un Retour sans Gravité (nudge sans Juge) n’atteint aucune Gravité minimale.
            </p>
          </div>
        </>
      )}
      <ErrorMessage erreur={erreur} />
      <button type="submit" disabled={enCours}>
        {libelleBouton}
      </button>
      {onAnnuler ? (
        <button type="button" className="secondaire" onClick={onAnnuler}>
          Annuler
        </button>
      ) : null}
      {actions}
    </form>
  );
}
