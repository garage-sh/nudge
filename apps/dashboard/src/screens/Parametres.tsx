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
  LIMITES_DASHBOARD,
  type RetentionVu,
} from '@nudge/shared';
import { useState, type FormEvent } from 'react';
import {
  useChangementRetention,
  useChoixJuge,
  useConfigurationAlerte,
  useDestinationAlerte,
  useJugeInstance,
  useRetention,
  useRetraitAlerte,
  useTestAlerte,
} from '../api/instance.js';
import {
  ConfirmAction,
  Confirmation,
  ErrorMessage,
  Field,
  Loading,
  PageHeader,
  StatutEnregistrement,
} from '../layout/ui.js';
import { DESCRIPTIONS_FOURNISSEUR_JUGE, LIBELLES_FOURNISSEUR_JUGE } from '../libelles.js';
import { ResultatTest, SecretsGeneres, type SecretsMontres } from './destinations/Destinations.js';
import { FormulaireDestination } from './destinations/FormulaireDestination.js';
import { FORMULAIRES_DESTINATION } from './destinations/types/index.js';

/**
 * Paramètres de l'Instance. Chaque paramètre est un bloc `encadre` : Juge,
 * Destination d'alerte, durée de rétention.
 */
export function Parametres() {
  const juge = useJugeInstance();
  const alerte = useDestinationAlerte();
  const retention = useRetention();
  return (
    <section>
      <PageHeader
        titre="Paramètres de l’Instance"
        description="Ces réglages valent pour tous les Projets et tous les Membres."
      />
      <div className="reglages">
        {juge.isPending || alerte.isPending || retention.isPending ? <Loading /> : null}
        <ErrorMessage
          erreur={juge.error ?? alerte.error ?? retention.error}
          onRetry={() => {
            void juge.refetch();
            void alerte.refetch();
            void retention.refetch();
          }}
        />
        {juge.data ? <Juge juge={juge.data} /> : null}
        {alerte.data ? <DestinationAlerte destination={alerte.data.destination} /> : null}
        {retention.data ? <Retention retention={retention.data} /> : null}
      </div>
    </section>
  );
}

/**
 * Durée de rétention des Retours : une tâche planifiée efface les Retours plus
 * anciens, avec leurs Captures. Champ vide : rétention illimitée.
 */
function Retention({ retention }: { retention: RetentionVu }) {
  const [jours, setJours] = useState(retention.jours === null ? '' : String(retention.jours));
  // Une durée plus courte efface des Retours : elle attend la confirmation du Membre.
  const [aConfirmer, setAConfirmer] = useState<number | null>(null);
  const changement = useChangementRetention();
  const enregistrer = (valeur: number | null) => changement.mutate({ jours: valeur });
  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    const valeur = jours === '' ? null : Number(jours);
    const efface = valeur !== null && (retention.jours === null || valeur < retention.jours);
    if (efface) setAConfirmer(valeur);
    else enregistrer(valeur);
  };
  return (
    <section className="encadre" aria-labelledby="parametres-retention">
      <h2 id="parametres-retention">Rétention des Retours</h2>
      <form onSubmit={soumettre} onChange={() => changement.reset()} className="formulaire">
        <p className="aide">
          {retention.jours === null
            ? 'Rétention illimitée : aucun Retour n’est effacé automatiquement.'
            : `Les Retours plus anciens que ${retention.jours} jours sont effacés automatiquement, avec leurs Captures.`}
        </p>
        <Field
          libelle="Durée de rétention (jours)"
          id="retention-jours"
          type="number"
          inputMode="numeric"
          min={1}
          max={LIMITES_DASHBOARD.retentionJoursMax}
          step={1}
          value={jours}
          onChange={(e) => setJours(e.target.value)}
          aide="Vide : rétention illimitée. L’effacement est définitif."
        />
        <ErrorMessage erreur={changement.error} />
        {aConfirmer === null ? (
          <div className="actions">
            <button type="submit" disabled={changement.isPending}>
              Enregistrer la rétention
            </button>
          </div>
        ) : (
          <Confirmation
            question={`Les Retours de plus de ${aConfirmer} jours et leurs Captures seront effacés définitivement à la prochaine purge. Enregistrer ?`}
            enCours={changement.isPending}
            onAnnuler={() => setAConfirmer(null)}
            onConfirm={() => {
              enregistrer(aConfirmer);
              setAConfirmer(null);
            }}
          />
        )}
        <StatutEnregistrement enregistre={changement.isSuccess} />
      </form>
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
        <StatutEnregistrement enregistre={configuration.isSuccess} />
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
    <form onSubmit={soumettre} onChange={() => choix.reset()} className="formulaire encadre">
      <h2>Juge</h2>
      <p className="aide">
        Le modèle de décision qui trie les Retours : il répond aux questions du Triage par des
        probabilités, là où un modèle de chat rédigerait du texte. Choisissez où il tourne, puis
        lequel. Sans Juge, nudge tourne en mode dégradé : le Type déclaré est retenu, sans Gravité
        ni détection d’Indésirable.
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
        {fournisseur ? <p className="aide">{DESCRIPTIONS_FOURNISSEUR_JUGE[fournisseur]}</p> : null}
      </div>
      {fournisseur ? (
        <>
          <Field
            libelle="Modèle"
            value={modele}
            placeholder={MODELES_JUGE_PAR_DEFAUT[fournisseur]}
            onChange={(e) => setModele(e.target.value)}
            aide={`Le nom du modèle chez ce fournisseur. Vide : ${MODELES_JUGE_PAR_DEFAUT[fournisseur]}.`}
          />
          <Field
            libelle={exigeUrlBase(fournisseur) ? 'URL du serveur' : 'URL de base (facultative)'}
            id="url-juge"
            type="url"
            required={exigeUrlBase(fournisseur)}
            value={urlBase}
            placeholder={exigeUrlBase(fournisseur) ? 'http://juge:8080' : ''}
            onChange={(e) => setUrlBase(e.target.value)}
            aide={
              exigeUrlBase(fournisseur)
                ? 'L’adresse de votre serveur : nudge y appelle <URL>/v1/decisions.'
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
      <div className="actions">
        <button type="submit" disabled={choix.isPending}>
          Enregistrer
        </button>
      </div>
      <StatutEnregistrement enregistre={choix.isSuccess} />
    </form>
  );
}
