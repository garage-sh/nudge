import {
  exigeCleApi,
  exigeUrlBase,
  FOURNISSEURS_JUGE,
  MODELES_JUGE_PAR_DEFAUT,
  estTypeDestination,
  FILTRE_TOUT,
  TYPES_DESTINATION,
  type FournisseurJuge,
  type ChoixJuge,
  type DestinationAlerteVu,
  type JugeInstanceVu,
} from '@nudge/shared';
import { useState, type FormEvent } from 'react';
import {
  useChoixJuge,
  useConfigurationAlerte,
  useDestinationAlerte,
  useJugeInstance,
  useRetraitAlerte,
  useTestAlerte,
} from '../api/instance.js';
import { ConfirmAction, ErrorMessage, Field, Loading } from '../layout/ui.js';
import { LIBELLES_FOURNISSEUR_JUGE } from '../libelles.js';
import { ResultatTest, SecretsGeneres, type SecretsMontres } from './destinations/Destinations.js';
import { FormulaireDestination } from './destinations/FormulaireDestination.js';
import { FORMULAIRES_DESTINATION } from './destinations/types/index.js';

/**
 * Paramètres de l'Instance. Chaque paramètre est un bloc `encadre` : la durée de
 * rétention s'ajoute ici à côté du Juge et de la Destination d'alerte.
 */
export function Parametres() {
  const juge = useJugeInstance();
  const alerte = useDestinationAlerte();
  return (
    <section>
      <h1>Paramètres de l’Instance</h1>
      {juge.isPending || alerte.isPending ? <Loading /> : null}
      <ErrorMessage erreur={juge.error ?? alerte.error} />
      {juge.data ? <Juge juge={juge.data} /> : null}
      {alerte.data ? <DestinationAlerte destination={alerte.data.destination} /> : null}
    </section>
  );
}

/**
 * La Destination d'alerte : un type de Destination, sans nom ni Filtre, qui reçoit
 * une alerte quand un Retour passe En revue ou qu'une Destination est Suspendue.
 */
function DestinationAlerte({ destination }: { destination: DestinationAlerteVu | null }) {
  const configuration = useConfigurationAlerte();
  const retrait = useRetraitAlerte();
  const test = useTestAlerte();
  const [secretsMontres, setSecretsMontres] = useState<SecretsMontres | null>(null);
  const type =
    destination && estTypeDestination(destination.type) ? destination.type : TYPES_DESTINATION[0];
  const config =
    destination && destination.type === type
      ? destination.config
      : FORMULAIRES_DESTINATION[type].configInitiale;

  return (
    <>
      <FormulaireDestination
        // Un formulaire neuf quand la Destination d'alerte change de type ou est retirée.
        key={destination?.type ?? 'aucune'}
        titre="Destination d’alerte"
        initiales={{ type, nom: '', config, filtre: FILTRE_TOUT }}
        typeModifiable
        sansNomNiFiltre
        secretsEnregistres={destination?.secrets ?? []}
        libelleBouton="Enregistrer l’alerte"
        enCours={configuration.isPending}
        erreur={configuration.error ?? retrait.error ?? test.error}
        onSubmit={({ type: choisi, config: saisie, secrets }) =>
          configuration.mutate(
            { type: choisi, config: saisie, ...(secrets ? { secrets } : {}) },
            {
              onSuccess: (resultat) =>
                setSecretsMontres(
                  Object.keys(resultat.secretsGeneres).length > 0
                    ? {
                        type: choisi,
                        nom: 'la Destination d’alerte',
                        secrets: resultat.secretsGeneres,
                      }
                    : null,
                ),
            },
          )
        }
        actions={
          destination ? (
            <>
              <button
                type="button"
                className="secondaire"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                Tester
              </button>
              <ConfirmAction
                libelle="Retirer"
                question="Plus aucune alerte ne partira. Retirer la Destination d’alerte ?"
                enCours={retrait.isPending}
                onConfirm={() => retrait.mutate()}
              />
            </>
          ) : null
        }
      >
        <p className="aide">
          Prévient les Membres quand un Retour passe En revue ou qu’une Destination est Suspendue,
          par l’un des types de Destination. Le dashboard les signale de toute façon.
        </p>
        <p className="discret">
          {destination
            ? `Enregistrée : ${FORMULAIRES_DESTINATION[type].libelle}.`
            : 'Aucune Destination d’alerte : les alertes ne partent nulle part.'}
        </p>
        {test.data ? <ResultatTest resultat={test.data} livre="Alerte d’exemple livrée." /> : null}
        {configuration.isSuccess ? <p className="discret">Enregistré.</p> : null}
      </FormulaireDestination>
      {secretsMontres ? <SecretsGeneres {...secretsMontres} /> : null}
    </>
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
