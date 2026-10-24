import type { ActiviteProjetVu } from '@nudge/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useActiviteProjets, useCreationProjet, useProjets } from '../api/projets.js';
import { EmptyState, ErrorMessage, Field, Loading, PageHeader, Pastille } from '../layout/ui.js';
import type { CleSecreteState } from './Projet.js';

export function Projets() {
  const projets = useProjets();
  const activite = useActiviteProjets();
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const aucun = projets.data?.length === 0;
  // Sans Projet, en créer un est la seule chose à faire : le formulaire est ouvert.
  const formulaireOuvert = ajoutOuvert || aucun;
  return (
    <section>
      <PageHeader
        titre="Projets"
        description="Chaque Projet est une application dont nudge collecte les Retours, avec ses propres clés et Destinations."
        actions={
          formulaireOuvert || !projets.data ? null : (
            <button type="button" onClick={() => setAjoutOuvert(true)}>
              Nouveau Projet
            </button>
          )
        }
      />
      {projets.isPending ? <Loading /> : null}
      <ErrorMessage erreur={projets.error} onRetry={() => void projets.refetch()} />
      {formulaireOuvert ? (
        <NouveauProjet onAnnuler={aucun ? undefined : () => setAjoutOuvert(false)} />
      ) : null}
      {aucun ? (
        <EmptyState titre="Aucun Projet pour l’instant.">
          Créez le premier ci-dessus : vous obtiendrez ses clés pour brancher le Widget ou l’API.
        </EmptyState>
      ) : null}
      {projets.data && projets.data.length > 0 ? (
        <ul className="liste projets" aria-label="Projets de l’Instance">
          {projets.data.map((projet) => (
            <li key={projet.id}>
              <div>
                <Link to={`/projets/${projet.id}/destinations`} className="projet-lien">
                  {projet.nom}
                </Link>
                {projet.description ? <p className="discret">{projet.description}</p> : null}
              </div>
              <Activite activite={activite.data?.get(projet.id)} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** Ce qui se passe dans un Projet ; rien tant que l'activité n'est pas lue. */
function Activite({ activite }: { activite: ActiviteProjetVu | undefined }) {
  if (!activite) return null;
  const { retoursSemaine, retoursEnRevue, destinations, destinationsSuspendues } = activite;
  return (
    <p className="activite-projet">
      <span>{pluriel(retoursSemaine, 'Retour')} cette semaine</span>
      {retoursEnRevue > 0 ? <Pastille ton="revue">{`${retoursEnRevue} En revue`}</Pastille> : null}
      {destinations === 0 ? (
        <Pastille ton="retenu">Aucune Destination</Pastille>
      ) : destinationsSuspendues > 0 ? (
        <Pastille ton="retenu">
          {`${pluriel(destinations, 'Destination')}, dont ${pluriel(destinationsSuspendues, 'Suspendue')}`}
        </Pastille>
      ) : (
        <span>{pluriel(destinations, 'Destination')}</span>
      )}
    </p>
  );
}

function NouveauProjet({ onAnnuler }: { onAnnuler?: () => void }) {
  const [nom, setNom] = useState('');
  const creation = useCreationProjet();
  const naviguer = useNavigate();
  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    creation.mutate(
      { nom },
      {
        // La clé secrète ne se lit qu'une fois : elle voyage dans l'état de navigation, jamais dans l'URL.
        onSuccess: ({ projet, cleSecrete }) => {
          const state: CleSecreteState = { cleSecrete };
          void naviguer(`/projets/${projet.id}`, { state });
        },
      },
    );
  };
  return (
    <form onSubmit={soumettre} className="formulaire encadre">
      <h2>Nouveau Projet</h2>
      <Field
        libelle="Nom du Projet"
        required
        value={nom}
        onChange={(e) => setNom(e.target.value)}
      />
      <ErrorMessage erreur={creation.error} />
      <div className="actions">
        <button type="submit" disabled={creation.isPending}>
          Créer le Projet
        </button>
        {onAnnuler ? (
          <button type="button" className="fantome" onClick={onAnnuler}>
            Annuler
          </button>
        ) : null}
      </div>
    </form>
  );
}
