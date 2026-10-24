import {
  exigeCleApi,
  exigeUrlBase,
  FOURNISSEURS_JUGE,
  MODELES_JUGE_PAR_DEFAUT,
  type FournisseurJuge,
  type ChoixJuge,
  type JugeInstanceVu,
} from '@nudge/shared';
import { useState, type FormEvent } from 'react';
import { useChoixJuge, useJugeInstance } from '../api/instance.js';
import { ErrorMessage, Field, Loading } from '../layout/ui.js';
import { LIBELLES_FOURNISSEUR_JUGE } from '../libelles.js';

/**
 * Paramètres de l'Instance. Chaque paramètre est un bloc `encadre` : la Destination
 * d'alerte et la durée de rétention s'ajoutent ici à côté du Juge.
 */
export function Parametres() {
  const juge = useJugeInstance();
  return (
    <section>
      <h1>Paramètres de l’Instance</h1>
      {juge.isPending ? <Loading /> : null}
      {juge.isError ? <ErrorMessage erreur={juge.error} /> : null}
      {juge.data ? <Juge juge={juge.data} /> : null}
    </section>
  );
}

function Juge({ juge }: { juge: JugeInstanceVu }) {
  const [fournisseur, setFournisseur] = useState<FournisseurJuge | ''>(juge.fournisseur ?? '');
  const [modele, setModele] = useState(juge.modele ?? '');
  const [urlBase, setUrlBase] = useState(juge.urlBase ?? '');
  const [cleApi, setCleApi] = useState('');
  const choix = useChoixJuge();
  // La clé enregistrée ne vaut que pour son fournisseur.
  const cleGardee = juge.cleConfiguree && fournisseur === juge.fournisseur;

  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    const corps: ChoixJuge = fournisseur
      ? {
          fournisseur,
          modele: modele || null,
          urlBase: urlBase || null,
          // Champ vide : la clé enregistrée est gardée (l'api ne la rend jamais).
          ...(cleApi ? { cleApi } : {}),
        }
      : { fournisseur: null };
    choix.mutate(corps, { onSuccess: () => setCleApi('') });
  };

  return (
    <form onSubmit={soumettre} className="formulaire encadre">
      <h2>Juge</h2>
      <p className="aide">
        Le modèle de décision qui trie les Retours. Sans Juge, nudge tourne en mode dégradé : le
        Type déclaré est retenu, sans Gravité ni détection d’Indésirable.
      </p>
      <div className="champ">
        <label htmlFor="fournisseur-juge">Fournisseur</label>
        <select
          id="fournisseur-juge"
          value={fournisseur}
          onChange={(e) => setFournisseur(e.target.value as FournisseurJuge | '')}
        >
          <option value="">Aucun (mode dégradé)</option>
          {FOURNISSEURS_JUGE.map((valeur) => (
            <option key={valeur} value={valeur}>
              {LIBELLES_FOURNISSEUR_JUGE[valeur]}
            </option>
          ))}
        </select>
      </div>
      {fournisseur ? (
        <>
          <Field
            libelle="Modèle"
            value={modele}
            placeholder={MODELES_JUGE_PAR_DEFAUT[fournisseur]}
            onChange={(e) => setModele(e.target.value)}
            aide="Vide : le modèle par défaut."
          />
          <Field
            libelle={exigeUrlBase(fournisseur) ? 'URL du serveur' : 'URL de base (facultative)'}
            id="url-juge"
            type="url"
            required={exigeUrlBase(fournisseur)}
            value={urlBase}
            placeholder={exigeUrlBase(fournisseur) ? 'http://decider:8080' : ''}
            onChange={(e) => setUrlBase(e.target.value)}
            aide={
              exigeUrlBase(fournisseur)
                ? 'Tout serveur de l’API Decisions : nudge appelle <URL>/v1/decisions.'
                : 'Seulement pour passer par un proxy ; vide : l’API du fournisseur.'
            }
          />
          <Field
            libelle="Clé API"
            type="password"
            autoComplete="off"
            required={exigeCleApi(fournisseur) && !cleGardee}
            value={cleApi}
            onChange={(e) => setCleApi(e.target.value)}
            aide={
              cleGardee
                ? 'Une clé est enregistrée (chiffrée) : laissez vide pour la garder.'
                : 'Stockée chiffrée, jamais réaffichée.'
            }
          />
        </>
      ) : null}
      <ErrorMessage erreur={choix.error} />
      <button type="submit" disabled={choix.isPending}>
        Enregistrer
      </button>
      {choix.isSuccess ? <span className="discret"> Enregistré.</span> : null}
    </form>
  );
}
