import { ETATS_RETOUR, GRAVITES, SOURCES, TYPES_RETOUR, type RetourResumeVu } from '@nudge/shared';
import { Link, useSearchParams } from 'react-router';
import { useProjets } from '../api/projets.js';
import {
  FILTRES_RETOURS,
  useRetours,
  type FiltresRetours,
  type NomFiltre,
} from '../api/retours.js';
import {
  formatDate,
  LIBELLES_ETAT,
  LIBELLES_GRAVITE,
  LIBELLES_SOURCE,
  LIBELLES_TYPE,
} from '../libelles.js';
import { ErrorMessage, Loading } from '../layout/ui.js';
import { BadgeIncertain } from './retour-badges.js';

/** Boîte de réception : les Retours de tous les Projets ; les filtres vivent dans l'URL. */
export function Retours() {
  const [parametres, setParametres] = useSearchParams();
  const filtres: FiltresRetours = Object.fromEntries(
    FILTRES_RETOURS.flatMap((nom) => {
      const valeur = parametres.get(nom);
      return valeur ? [[nom, valeur]] : [];
    }),
  );
  const filtrer = (nom: NomFiltre, valeur: string) => {
    const suivants = new URLSearchParams(parametres);
    if (valeur) suivants.set(nom, valeur);
    else suivants.delete(nom);
    setParametres(suivants, { replace: true });
  };
  const retours = useRetours(filtres);
  const lignes = retours.data?.pages.flatMap((page) => page.retours) ?? [];

  return (
    <section>
      <h1>Boîte de réception</h1>
      <Filtres filtres={filtres} filtrer={filtrer} />
      {retours.isPending ? <Loading /> : null}
      <ErrorMessage erreur={retours.error} />
      {retours.isSuccess && lignes.length === 0 ? (
        <p className="discret">
          {Object.keys(filtres).length > 0
            ? 'Aucun Retour ne correspond à ces filtres.'
            : 'Aucun Retour pour l’instant.'}
        </p>
      ) : null}
      <ul className="liste">
        {lignes.map((retour) => (
          <LigneRetour key={retour.id} retour={retour} />
        ))}
      </ul>
      {retours.hasNextPage ? (
        <button
          type="button"
          className="secondaire plus"
          disabled={retours.isFetchingNextPage}
          onClick={() => void retours.fetchNextPage()}
        >
          Afficher plus
        </button>
      ) : null}
    </section>
  );
}

function Filtres({
  filtres,
  filtrer,
}: {
  filtres: FiltresRetours;
  filtrer: (nom: NomFiltre, valeur: string) => void;
}) {
  const projets = useProjets();
  const options = (valeurs: readonly string[], libelles: Record<string, string>) =>
    valeurs.map((valeur) => ({ valeur, libelle: libelles[valeur] ?? valeur }));
  const selects = [
    {
      nom: 'projet',
      libelle: 'Projet',
      options: (projets.data ?? []).map((p) => ({ valeur: p.id, libelle: p.nom })),
    },
    { nom: 'type', libelle: 'Type', options: options(TYPES_RETOUR, LIBELLES_TYPE) },
    { nom: 'gravite', libelle: 'Gravité', options: options(GRAVITES, LIBELLES_GRAVITE) },
    { nom: 'etat', libelle: 'État', options: options(ETATS_RETOUR, LIBELLES_ETAT) },
    { nom: 'source', libelle: 'Source', options: options(SOURCES, LIBELLES_SOURCE) },
    {
      nom: 'incertain',
      libelle: 'Verdict',
      options: [
        { valeur: 'true', libelle: 'Incertains seulement' },
        { valeur: 'false', libelle: 'Sans les Incertains' },
      ],
    },
  ] as const;
  return (
    <div className="filtres" role="group" aria-label="Filtres">
      {selects.map(({ nom, libelle, options: choix }) => (
        <div className="champ" key={nom}>
          <label htmlFor={`filtre-${nom}`}>{libelle}</label>
          <select
            id={`filtre-${nom}`}
            value={filtres[nom] ?? ''}
            onChange={(e) => filtrer(nom, e.target.value)}
          >
            <option value="">Tous</option>
            {choix.map(({ valeur, libelle: texte }) => (
              <option key={valeur} value={valeur}>
                {texte}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function LigneRetour({ retour }: { retour: RetourResumeVu }) {
  const { verdict } = retour;
  return (
    <li className="ligne-retour">
      <Link to={`/retours/${retour.id}`} className="apercu">
        {retour.apercu}
      </Link>
      <p className="meta">
        <span>{retour.projet.nom}</span>
        <span>{verdict ? LIBELLES_TYPE[verdict.typeRetenu] : 'Non trié'}</span>
        {verdict?.gravite ? <span>{LIBELLES_GRAVITE[verdict.gravite]}</span> : null}
        <span>{LIBELLES_ETAT[retour.etat]}</span>
        <span>{LIBELLES_SOURCE[retour.source]}</span>
        <time dateTime={retour.createdAt}>{formatDate(retour.createdAt)}</time>
        {verdict?.incertain ? <BadgeIncertain /> : null}
      </p>
    </li>
  );
}
