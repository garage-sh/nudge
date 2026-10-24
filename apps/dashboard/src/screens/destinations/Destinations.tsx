import {
  estTypeDestination,
  FILTRE_TOUT,
  TYPES_DESTINATION,
  type DestinationVu,
  type FiltreVu,
  type ResultatTestDestination,
} from '@nudge/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
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
  ErrorMessage,
  LienExterne,
  Loading,
} from '../../layout/ui.js';
import {
  LIBELLES_CLASSE_ECHEC,
  LIBELLES_ETAT_DESTINATION,
  LIBELLES_GRAVITE,
  LIBELLES_TYPE,
} from '../../libelles.js';
import { FormulaireDestination } from './FormulaireDestination.js';
import { formulaireDe, FORMULAIRES_DESTINATION } from './types/index.js';

/** Secrets générés par l'Instance, montrés une seule fois après création ou régénération. */
interface SecretsMontres {
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
  if (projet.isPending || destinations.isPending) return <Loading />;
  if (projet.isError) return <ErrorMessage erreur={projet.error} />;
  if (destinations.isError) return <ErrorMessage erreur={destinations.error} />;
  const montrer: MontrerSecrets = (destination, secrets) =>
    setSecretsMontres(
      Object.keys(secrets).length > 0
        ? { type: destination.type, nom: destination.nom, secrets }
        : null,
    );

  return (
    <section>
      <p className="discret">
        <Link to={`/projets/${encodeURIComponent(projetId)}`}>← {projet.data.nom}</Link>
      </p>
      <h1>Destinations de {projet.data.nom}</h1>
      <p className="aide">
        Chaque Retour Trié part vers toutes les Destinations dont le Filtre le retient.
      </p>
      {secretsMontres ? <SecretsGeneres {...secretsMontres} /> : null}
      {destinations.data.length === 0 ? (
        <p className="discret">Aucune Destination : les Retours Triés ne partent nulle part.</p>
      ) : (
        destinations.data.map((destination) => (
          <CarteDestination key={destination.id} destination={destination} montrer={montrer} />
        ))
      )}
      <Ajout projetId={projetId} montrer={montrer} />
    </section>
  );
}

function SecretsGeneres({ type, nom, secrets }: SecretsMontres) {
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

const resumeFiltre = ({ types, graviteMinimale }: FiltreVu): string =>
  `${types.map((type) => LIBELLES_TYPE[type]).join(', ')} · ${
    graviteMinimale ? `Gravité ${LIBELLES_GRAVITE[graviteMinimale]} ou plus` : 'toute Gravité'
  }`;

function CarteDestination({
  destination,
  montrer,
}: {
  destination: DestinationVu;
  montrer: MontrerSecrets;
}) {
  const [enEdition, setEnEdition] = useState(false);
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
    <article className="encadre">
      <h2>{destination.nom}</h2>
      <p>
        <span>{formulaire?.libelle ?? destination.type}</span> ·{' '}
        <span>{LIBELLES_ETAT_DESTINATION[destination.etat]}</span>
      </p>
      {formulaire ? <p className="lien-brut">{formulaire.resume(destination.config)}</p> : null}
      <p className="discret">{resumeFiltre(destination.filtre)}</p>
      <div className="actions">
        <button type="button" disabled={test.isPending} onClick={() => test.mutate()}>
          Tester
        </button>
        {formulaire ? (
          <button type="button" className="secondaire" onClick={() => setEnEdition(true)}>
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

function ResultatTest({ resultat }: { resultat: ResultatTestDestination }) {
  if (resultat.statut === 'livre') {
    return (
      <p role="status">
        Retour d’exemple livré.
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

function Ajout({ projetId, montrer }: { projetId: string; montrer: MontrerSecrets }) {
  const creation = useCreationDestination(projetId);
  // Chaque ajout remonte le formulaire, qui repart vide.
  const [ajouts, setAjouts] = useState(0);
  const type = TYPES_DESTINATION[0];
  return (
    <FormulaireDestination
      key={ajouts}
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
      onSubmit={(valeurs) =>
        creation.mutate(valeurs, {
          onSuccess: (resultat) => {
            montrer(resultat.destination, resultat.secretsGeneres);
            setAjouts((n) => n + 1);
          },
        })
      }
    />
  );
}
