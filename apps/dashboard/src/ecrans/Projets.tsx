import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreationProjet, useProjets } from '../api/projets.js';
import { Chargement, Champ, MessageErreur } from '../mise-en-page/ui.js';
import type { CleSecreteState } from './Projet.js';

export function Projets() {
  const projets = useProjets();
  return (
    <section>
      <h1>Projets</h1>
      {projets.isPending ? <Chargement /> : null}
      <MessageErreur erreur={projets.error} />
      {projets.data?.length === 0 ? (
        <p className="discret">Aucun Projet pour l’instant : créez le premier ci-dessous.</p>
      ) : null}
      <ul className="liste">
        {projets.data?.map((projet) => (
          <li key={projet.id}>
            <Link to={`/projets/${projet.id}`}>{projet.nom}</Link>
            {projet.description ? <p className="discret">{projet.description}</p> : null}
          </li>
        ))}
      </ul>
      <NouveauProjet />
    </section>
  );
}

function NouveauProjet() {
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
      <Champ
        libelle="Nom du Projet"
        required
        value={nom}
        onChange={(e) => setNom(e.target.value)}
      />
      <MessageErreur erreur={creation.error} />
      <button type="submit" disabled={creation.isPending}>
        Créer le Projet
      </button>
    </form>
  );
}
