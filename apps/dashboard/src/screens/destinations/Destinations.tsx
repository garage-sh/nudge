import {
  estTypeDestination,
  FILTRE_TOUT,
  TYPES_DESTINATION,
  type DestinationVu,
  type FiltreVu,
  type ResultatTestDestination,
} from '@nudge/shared';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  useCreationDestination,
  useDestinations,
  useModificationDestination,
  useRegenerationSecretsGeneres,
  useSuppressionDestination,
  useTestDestination,
} from '../../api/destinations.js';
import { useProjet } from '../../api/projets.js';
import {
  ConfirmAction,
  CopyableValue,
  EmptyState,
  ErrorMessage,
  LienExterne,
  Loading,
  useFocusAuRetour,
} from '../../layout/ui.js';
import { LIBELLES_CLASSE_ECHEC, LIBELLES_GRAVITE, LIBELLES_TYPE } from '../../libelles.js';
import { EnteteProjet, ProjetIntrouvable } from '../Projet.js';
import { JaugeGravite, PastilleEtatDestination } from '../retour-badges.js';
import { FormulaireDestination } from './FormulaireDestination.js';
import { formulaireDe, FORMULAIRES_DESTINATION } from './types/index.js';

/** Secrets générés par l'Instance, montrés une seule fois après création ou régénération. */
export interface SecretsMontres {
  readonly type: string;
  readonly nom: string;
  readonly secrets: Readonly<Record<string, string>>;
}

/** Montre les secrets qu'une création ou une régénération vient de générer. */
type MontrerSecrets = (
  destination: DestinationVu,
  secrets: Readonly<Record<string, string>>,
) => void;

export function Destinations() {
  const projetId = useParams().id ?? '';
  const projet = useProjet(projetId);
  const destinations = useDestinations(projetId);
  const [secretsMontres, setSecretsMontres] = useState<SecretsMontres | null>(null);
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [ajoutee, setAjoutee] = useState<string | null>(null);
  if (projet.isPending || destinations.isPending) return <Loading />;
  if (projet.isError) {
    return <ProjetIntrouvable erreur={projet.error} onRetry={() => void projet.refetch()} />;
  }
  if (destinations.isError) {
    return (
      <section>
        <EnteteProjet projet={projet.data} />
        <ErrorMessage erreur={destinations.error} onRetry={() => void destinations.refetch()} />
      </section>
    );
  }
  const montrer: MontrerSecrets = (destination, secrets) =>
    setSecretsMontres(
      Object.keys(secrets).length > 0
        ? { type: destination.type, nom: destination.nom, secrets }
        : null,
    );
  const aucune = destinations.data.length === 0;
  // Sans Destination, le formulaire d'ajout est la seule chose à faire : il est ouvert.
  const formulaireOuvert = ajoutOuvert || aucune;

  return (
    <section>
      <EnteteProjet
        projet={projet.data}
        actions={
          formulaireOuvert ? null : (
            <button type="button" onClick={() => setAjoutOuvert(true)}>
              Ajouter une Destination
            </button>
          )
        }
      />
      <p className="aide intro-onglet">
        Chaque Retour Trié part vers toutes les Destinations dont le Filtre le retient.
      </p>
      {secretsMontres ? <SecretsGeneres {...secretsMontres} /> : null}
      {formulaireOuvert ? (
        <Ajout
          projetId={projetId}
          montrer={montrer}
          onAjoutee={(id) => {
            setAjoutee(id);
            setAjoutOuvert(false);
          }}
          onAnnuler={aucune ? undefined : () => setAjoutOuvert(false)}
        />
      ) : null}
      {aucune ? (
        <EmptyState titre="Aucune Destination : les Retours Triés ne partent nulle part.">
          Ajoutez-en une ci-dessus : un dépôt GitHub, une équipe Linear, un salon Slack ou Discord,
          ou votre propre webhook.
        </EmptyState>
      ) : (
        <ul className="liste destinations">
          {destinations.data.map((destination) => (
            <li key={destination.id}>
              <LigneDestination
                destination={destination}
                montrer={montrer}
                focus={destination.id === ajoutee}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SecretsGeneres({ type, nom, secrets }: SecretsMontres) {
  const descriptions: Readonly<Record<string, { libelle: string; aide: string }>> =
    formulaireDe(type)?.secretsGeneres ?? {};
  return (
    <div className="avertissement encadre" role="status">
      <p>Copiez maintenant le secret de « {nom} » : il ne sera plus jamais affiché.</p>
      {Object.entries(secrets).map(([cle, valeur]) => {
        const description = descriptions[cle];
        return (
          <div key={cle}>
            <h3>{description?.libelle ?? cle}</h3>
            {description ? <p className="aide">{description.aide}</p> : null}
            <CopyableValue libelle={description?.libelle ?? cle} valeur={valeur} />
          </div>
        );
      })}
    </div>
  );
}

/** Le Filtre, lisible : les Types retenus, et le seuil de Gravité en jauge. */
function ResumeFiltre({ filtre: { types, graviteMinimale } }: { filtre: FiltreVu }) {
  return (
    <p className="destination-filtre">
      <span>{types.map((type) => LIBELLES_TYPE[type]).join(', ')}</span>
      {graviteMinimale ? (
        <JaugeGravite
          gravite={graviteMinimale}
          libelle={`${LIBELLES_GRAVITE[graviteMinimale]} ou plus`}
        />
      ) : (
        <span>toute Gravité</span>
      )}
    </p>
  );
}

function LigneDestination({
  destination,
  montrer,
  focus = false,
}: {
  destination: DestinationVu;
  montrer: MontrerSecrets;
  /** La Destination vient d'être ajoutée : son nom prend le focus. */
  focus?: boolean;
}) {
  const [enEdition, setEnEdition] = useState(false);
  const modifier = useFocusAuRetour(enEdition);
  const titre = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) titre.current?.focus();
  }, [focus]);
  const formulaire = formulaireDe(destination.type);
  const modification = useModificationDestination(destination.projetId, destination.id);
  const suppression = useSuppressionDestination(destination.projetId, destination.id);
  const regeneration = useRegenerationSecretsGeneres(destination.projetId, destination.id);
  const test = useTestDestination(destination.id);

  if (enEdition && estTypeDestination(destination.type)) {
    return (
      <FormulaireDestination
        titre={`Modifier ${destination.nom}`}
        initiales={{ ...destination, type: destination.type, config: { ...destination.config } }}
        typeModifiable={false}
        secretsEnregistres={destination.secrets}
        libelleBouton="Enregistrer"
        enCours={modification.isPending}
        erreur={modification.error}
        onAnnuler={() => setEnEdition(false)}
        onSubmit={({ nom, config, filtre, secrets }) =>
          modification.mutate(
            {
              nom,
              config,
              filtre,
              ...(secrets ? { secrets } : {}),
            },
            { onSuccess: () => setEnEdition(false) },
          )
        }
      />
    );
  }

  const aDesSecretsGeneres = formulaire && Object.keys(formulaire.secretsGeneres).length > 0;
  return (
    <article className="destination" data-etat={destination.etat}>
      <div className="destination-ligne">
        <div className="destination-nom">
          <h2 ref={titre} tabIndex={-1}>
            {destination.nom}
          </h2>
          <p>
            <span className="destination-type">{formulaire?.libelle ?? destination.type}</span>
            {formulaire ? (
              <span className="destination-cible">{formulaire.resume(destination.config)}</span>
            ) : null}
          </p>
        </div>
        <ResumeFiltre filtre={destination.filtre} />
        <PastilleEtatDestination etat={destination.etat} />
      </div>
      {destination.etat === 'suspendue' ? (
        <p className="probleme">
          Ses Envois échouent de façon répétée : ils sont retenus et repartiront dès qu’elle
          redeviendra joignable. Vérifiez sa configuration, puis testez-la.
        </p>
      ) : null}
      <div className="actions">
        <button
          type="button"
          className="secondaire"
          disabled={test.isPending}
          onClick={() => test.mutate()}
        >
          Tester
        </button>
        {formulaire ? (
          <button
            ref={modifier}
            type="button"
            className="secondaire"
            onClick={() => setEnEdition(true)}
          >
            Modifier
          </button>
        ) : null}
        {aDesSecretsGeneres ? (
          <ConfirmAction
            libelle={`Régénérer le ${Object.values(formulaire.secretsGeneres)
              .map((s) => s.libelle.toLowerCase())
              .join(', ')}`}
            question="L’ancien secret cessera de valoir pour les prochains appels. Régénérer ?"
            enCours={regeneration.isPending}
            onConfirm={() =>
              regeneration.mutate(undefined, {
                onSuccess: (resultat) => montrer(resultat.destination, resultat.secretsGeneres),
              })
            }
          />
        ) : null}
        <ConfirmAction
          libelle="Supprimer"
          question="La Destination et l’historique de ses Envois seront supprimés. Supprimer ?"
          enCours={suppression.isPending}
          onConfirm={() => suppression.mutate()}
        />
      </div>
      {test.data ? <ResultatTest resultat={test.data} /> : null}
      <ErrorMessage erreur={test.error ?? regeneration.error ?? suppression.error} />
    </article>
  );
}

/** Résultat du bouton « tester » ; `livre` : ce qui a été livré (un Retour, une alerte d'exemple). */
export function ResultatTest({
  resultat,
  livre = 'Retour d’exemple livré.',
}: {
  resultat: ResultatTestDestination;
  livre?: string;
}) {
  if (resultat.statut === 'livre') {
    return (
      <p role="status">
        {livre}
        {resultat.lienExterne ? (
          <>
            {' '}
            <LienExterne href={resultat.lienExterne} />
          </>
        ) : null}
      </p>
    );
  }
  return (
    <p role="status" className="alerte">
      Échec ({LIBELLES_CLASSE_ECHEC[resultat.classe]}) : {resultat.message}
    </p>
  );
}

function Ajout({
  projetId,
  montrer,
  onAjoutee,
  onAnnuler,
}: {
  projetId: string;
  montrer: MontrerSecrets;
  onAjoutee: (id: string) => void;
  onAnnuler?: () => void;
}) {
  const creation = useCreationDestination(projetId);
  const type = TYPES_DESTINATION[0];
  return (
    <FormulaireDestination
      titre="Ajouter une Destination"
      initiales={{
        type,
        nom: '',
        config: { ...FORMULAIRES_DESTINATION[type].configInitiale },
        filtre: FILTRE_TOUT,
      }}
      typeModifiable
      libelleBouton="Ajouter"
      enCours={creation.isPending}
      erreur={creation.error}
      onAnnuler={onAnnuler}
      onSubmit={(valeurs) =>
        creation.mutate(valeurs, {
          onSuccess: (resultat) => {
            montrer(resultat.destination, resultat.secretsGeneres);
            onAjoutee(resultat.destination.id);
          },
        })
      }
    />
  );
}
