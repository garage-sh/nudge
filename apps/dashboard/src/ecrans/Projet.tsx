import type { ProjetVu } from '@nudge/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import {
  useModificationProjet,
  useProjet,
  useRegenerationClePublique,
  useRegenerationCleSecrete,
} from '../api/projets.js';
import {
  ActionConfirmee,
  Chargement,
  Champ,
  MessageErreur,
  ValeurCopiable,
} from '../mise-en-page/ui.js';

/** État de navigation : la clé secrète d'un Projet tout juste créé. */
export interface CleSecreteState {
  readonly cleSecrete?: string;
}

/**
 * La clé secrète reçue à la création, retirée aussitôt de l'historique du
 * navigateur (qui survit au rechargement) : elle ne vit que dans cet écran.
 */
function useCleSecreteRecue(): [string | null, (cle: string) => void] {
  const location = useLocation();
  const naviguer = useNavigate();
  const [cle, setCle] = useState(
    () => (location.state as CleSecreteState | null)?.cleSecrete ?? null,
  );
  const aPurger = Boolean((location.state as CleSecreteState | null)?.cleSecrete);
  useEffect(() => {
    if (aPurger) void naviguer(location.pathname, { replace: true, state: null });
  }, [aPurger, location.pathname, naviguer]);
  return [cle, setCle];
}

export function Projet() {
  const id = useParams().id ?? '';
  const projet = useProjet(id);
  if (projet.isPending) return <Chargement />;
  if (projet.isError) return <MessageErreur erreur={projet.error} />;
  return (
    <section>
      <h1>{projet.data.nom}</h1>
      <Cles projet={projet.data} />
      <Informations projet={projet.data} />
      <Origines projet={projet.data} />
    </section>
  );
}

function Cles({ projet }: { projet: ProjetVu }) {
  const [cleSecrete, setCleSecrete] = useCleSecreteRecue();
  const publique = useRegenerationClePublique(projet.id);
  const secrete = useRegenerationCleSecrete(projet.id);
  return (
    <div className="encadre">
      <h2>Clés</h2>
      <h3>Clé publique</h3>
      <p className="aide">Pour le Widget ; acceptée seulement depuis les origines autorisées.</p>
      <ValeurCopiable libelle="Clé publique" valeur={projet.clePublique} />
      <ActionConfirmee
        libelle="Régénérer la clé publique"
        question="L’ancienne clé publique cessera de fonctionner. Régénérer ?"
        enCours={publique.isPending}
        onConfirm={() => publique.mutate()}
      />
      <MessageErreur erreur={publique.error} />

      <h3>Clé secrète</h3>
      <p className="aide">Pour envoyer des Retours depuis un serveur. Ne la publiez jamais.</p>
      {cleSecrete ? (
        <div className="avertissement" role="status">
          <p>Copiez la clé secrète maintenant : elle ne sera plus jamais affichée.</p>
          <ValeurCopiable libelle="Clé secrète" valeur={cleSecrete} />
        </div>
      ) : (
        <p className="discret">Affichée une seule fois, à sa création. Perdue ? Régénérez-la.</p>
      )}
      <ActionConfirmee
        libelle="Régénérer la clé secrète"
        question="L’ancienne clé secrète cessera immédiatement de fonctionner. Régénérer ?"
        enCours={secrete.isPending}
        onConfirm={() =>
          secrete.mutate(undefined, { onSuccess: (resultat) => setCleSecrete(resultat.cleSecrete) })
        }
      />
      <MessageErreur erreur={secrete.error} />
    </div>
  );
}

function Informations({ projet }: { projet: ProjetVu }) {
  const [nom, setNom] = useState(projet.nom);
  const [description, setDescription] = useState(projet.description ?? '');
  const modification = useModificationProjet(projet.id);
  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    modification.mutate({ nom, description });
  };
  return (
    <form onSubmit={soumettre} className="formulaire encadre">
      <h2>Informations</h2>
      <Champ
        libelle="Nom du Projet"
        required
        value={nom}
        onChange={(e) => setNom(e.target.value)}
      />
      <div className="champ">
        <label htmlFor="description-projet">Description du Projet</label>
        <textarea
          id="description-projet"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="aide">
          Facultative. Dites au Juge ce qu’est le Projet et ce qui y est critique, pour qu’il évalue
          mieux la Gravité.
        </p>
      </div>
      <MessageErreur erreur={modification.error} />
      <button type="submit" disabled={modification.isPending}>
        Enregistrer
      </button>
      {modification.isSuccess ? <span className="discret"> Enregistré.</span> : null}
    </form>
  );
}

function Origines({ projet }: { projet: ProjetVu }) {
  const [texte, setTexte] = useState(projet.originesAutorisees.join('\n'));
  const modification = useModificationProjet(projet.id);
  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    const originesAutorisees = texte
      .split('\n')
      .map((ligne) => ligne.trim())
      .filter(Boolean);
    modification.mutate(
      { originesAutorisees },
      { onSuccess: (enregistre) => setTexte(enregistre.originesAutorisees.join('\n')) },
    );
  };
  return (
    <form onSubmit={soumettre} className="formulaire encadre">
      <h2>Origines autorisées</h2>
      <div className="champ">
        <label htmlFor="origines-projet">Une origine par ligne</label>
        <textarea
          id="origines-projet"
          rows={4}
          placeholder="https://app.exemple.com"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
        />
        <p className="aide">
          Le Widget n’est accepté que depuis ces origines (schéma://hôte[:port], sans chemin).
        </p>
      </div>
      <MessageErreur erreur={modification.error} />
      <button type="submit" disabled={modification.isPending}>
        Enregistrer
      </button>
      {modification.isSuccess ? <span className="discret"> Enregistré.</span> : null}
    </form>
  );
}
