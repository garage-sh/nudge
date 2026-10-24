import {
  GRAVITES,
  SOURCES,
  TYPES_RETOUR,
  type EtatRetour,
  type RetourResumeVu,
} from '@nudge/shared';
import { Link, useSearchParams } from 'react-router';
import { useAlertes } from '../api/alertes.js';
import { useProjets } from '../api/projets.js';
import {
  FILTRES_RETOURS,
  useRetours,
  type FiltresRetours,
  type NomFiltre,
} from '../api/retours.js';
import { EmptyState, ErrorMessage, Loading, PageHeader } from '../layout/ui.js';
import {
  formatDate,
  formatDateRelative,
  formatJour,
  LIBELLES_GRAVITE,
  LIBELLES_SOURCE,
  LIBELLES_TYPE,
} from '../libelles.js';
import { BadgeIncertain, JaugeGravite, PastilleEtat } from './retour-badges.js';

/** L'état de navigation qu'un Retour ouvert depuis la liste reçoit : la liste, pour Précédent / Suivant. */
export interface ListeState {
  readonly liste?: { readonly ids: readonly string[]; readonly recherche: string };
}

/** Les vues de la boîte de réception : un raccourci vers le filtre d'État. */
const VUES: readonly { readonly etat: EtatRetour | null; readonly libelle: string }[] = [
  { etat: null, libelle: 'Tous' },
  { etat: 'en_revue', libelle: 'En revue' },
  { etat: 'recu', libelle: 'Reçus' },
  { etat: 'trie', libelle: 'Triés' },
  { etat: 'dispatche', libelle: 'Dispatchés' },
  { etat: 'ecarte', libelle: 'Écartés' },
];

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
  const effacerFiltres = () => {
    const suivants = new URLSearchParams();
    if (filtres.etat) suivants.set('etat', filtres.etat);
    setParametres(suivants, { replace: true });
  };
  const retours = useRetours(filtres);
  const lignes = retours.data?.pages.flatMap((page) => page.retours) ?? [];
  const filtresHorsVue = Object.keys(filtres).filter((nom) => nom !== 'etat');
  const liste: ListeState['liste'] = {
    ids: lignes.map((retour) => retour.id),
    recherche: parametres.toString(),
  };

  return (
    <section>
      <PageHeader titre="Boîte de réception" />
      <Vues etat={filtres.etat} parametres={parametres} />
      <Filtres filtres={filtres} filtrer={filtrer} />
      {retours.isFetchNextPageError ? null : (
        <ErrorMessage erreur={retours.error} onRetry={() => void retours.refetch()} />
      )}
      <p role="status" className="visuellement-cache">
        {retours.isSuccess
          ? `${lignes.length} Retour${lignes.length > 1 ? 's' : ''} affiché${lignes.length > 1 ? 's' : ''}${retours.hasNextPage ? ', d’autres à charger' : ''}.`
          : ''}
      </p>
      {retours.isPending ? (
        <div className="liste-retours">
          <Loading />
        </div>
      ) : null}
      {retours.isSuccess && lignes.length === 0 ? (
        filtresHorsVue.length > 0 || filtres.etat ? (
          <EmptyState
            titre="Aucun Retour ne correspond à ces filtres."
            action={
              filtresHorsVue.length > 0 ? (
                <button type="button" className="secondaire" onClick={effacerFiltres}>
                  Effacer les filtres
                </button>
              ) : null
            }
          />
        ) : (
          <EmptyState titre="Aucun Retour pour l’instant.">
            Les Retours arrivent ici dès qu’un Projet en reçoit, par le Widget ou par l’API. La page
            d’un Projet donne ses clés.
          </EmptyState>
        )
      ) : null}
      {lignes.length > 0 ? (
        <div className="liste-retours">
          {grouperParJour(lignes).map(({ jour, retours: duJour }) => (
            <section key={jour} aria-label={jour}>
              <h2 className="groupe-jour">{jour}</h2>
              <ul className="lignes-retours">
                {duJour.map((retour) => (
                  <LigneRetour key={retour.id} retour={retour} liste={liste} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {retours.hasNextPage ? (
        <button
          type="button"
          className="secondaire plus"
          disabled={retours.isFetchingNextPage}
          onClick={() => void retours.fetchNextPage()}
        >
          {retours.isFetchingNextPage ? 'Chargement…' : 'Afficher plus'}
        </button>
      ) : null}
      {retours.isFetchNextPageError ? (
        <ErrorMessage erreur={retours.error} onRetry={() => void retours.fetchNextPage()} />
      ) : null}
    </section>
  );
}

/** Les Retours, déjà du plus récent au plus ancien, regroupés par jour de réception. */
function grouperParJour(retours: readonly RetourResumeVu[]) {
  const groupes: { jour: string; retours: RetourResumeVu[] }[] = [];
  for (const retour of retours) {
    const jour = formatJour(retour.createdAt);
    const dernier = groupes.at(-1);
    if (dernier?.jour === jour) dernier.retours.push(retour);
    else groupes.push({ jour, retours: [retour] });
  }
  return groupes;
}

function Vues({ etat, parametres }: { etat: string | undefined; parametres: URLSearchParams }) {
  const enRevue = useAlertes().data?.retoursEnRevue ?? 0;
  const vers = (cible: EtatRetour | null) => {
    const suivants = new URLSearchParams(parametres);
    if (cible) suivants.set('etat', cible);
    else suivants.delete('etat');
    const recherche = suivants.toString();
    return recherche ? `/retours?${recherche}` : '/retours';
  };
  return (
    <nav className="vues" aria-label="Vues">
      {VUES.map(({ etat: cible, libelle }) => (
        <Link
          key={libelle}
          to={vers(cible)}
          replace
          aria-current={(etat ?? null) === cible ? 'page' : undefined}
        >
          {libelle}
          {cible === 'en_revue' && enRevue > 0 ? (
            <span className="compteur-revue">
              <span className="visuellement-cache">, </span>
              {enRevue}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
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
      tous: 'Tous',
      options: (projets.data ?? []).map((p) => ({ valeur: p.id, libelle: p.nom })),
    },
    { nom: 'type', libelle: 'Type', tous: 'Tous', options: options(TYPES_RETOUR, LIBELLES_TYPE) },
    {
      nom: 'gravite',
      libelle: 'Gravité',
      tous: 'Toutes',
      options: options(GRAVITES, LIBELLES_GRAVITE),
    },
    {
      nom: 'source',
      libelle: 'Source',
      tous: 'Toutes',
      options: options(SOURCES, LIBELLES_SOURCE),
    },
    {
      nom: 'incertain',
      libelle: 'Verdict',
      tous: 'Tous',
      options: [
        { valeur: 'true', libelle: 'Incertains seulement' },
        { valeur: 'false', libelle: 'Sans les Incertains' },
      ],
    },
  ] as const;
  return (
    <div className="filtres" role="group" aria-label="Filtres">
      {selects.map(({ nom, libelle, tous, options: choix }) => (
        <div key={nom} className="filtre" data-actif={Boolean(filtres[nom])}>
          <label htmlFor={`filtre-${nom}`}>{libelle}</label>
          <select
            id={`filtre-${nom}`}
            value={filtres[nom] ?? ''}
            onChange={(e) => filtrer(nom, e.target.value)}
          >
            <option value="">{tous}</option>
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

function LigneRetour({ retour, liste }: { retour: RetourResumeVu; liste: ListeState['liste'] }) {
  const { verdict } = retour;
  const state: ListeState = { liste };
  return (
    <li className="ligne-retour" data-etat={retour.etat}>
      <JaugeGravite gravite={verdict?.gravite} />
      <p className="corps">
        <strong className="type">{verdict ? LIBELLES_TYPE[verdict.typeRetenu] : 'Non trié'}</strong>
        <Link to={`/retours/${retour.id}`} state={state} className="apercu">
          {retour.apercu}
        </Link>
      </p>
      <span className="projet">{retour.projet.nom}</span>
      <span className="etats">
        {verdict?.incertain ? <BadgeIncertain /> : null}
        <PastilleEtat etat={retour.etat} />
      </span>
      <time dateTime={retour.createdAt} title={formatDate(retour.createdAt)}>
        {formatDateRelative(retour.createdAt)}
      </time>
    </li>
  );
}
