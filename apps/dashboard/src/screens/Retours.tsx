import {
  GRAVITES,
  SOURCES,
  TYPES_RETOUR,
  type EtatRetour,
  type RetourResumeVu,
} from '@nudge/shared';
import { createContext, useEffect, useRef } from 'react';
import { Link, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router';
import { useAlertes } from '../api/alertes.js';
import { useProjets } from '../api/projets.js';
import {
  FILTRES_RETOURS,
  useRetours,
  type FiltresRetours,
  type NomFiltre,
} from '../api/retours.js';
import { EmptyState, ErrorMessage, Loading, PageHeader, useMediaQuery } from '../layout/ui.js';
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
  readonly liste?: { readonly ids: readonly string[] };
}

/**
 * Présent quand le Retour s'affiche dans le volet de la Boîte de réception, à côté de
 * la liste : la fiche se ferme au lieu de ramener à la liste.
 */
export const VoletRetour = createContext<{ readonly fermer: string } | null>(null);

/** Largeur à partir de laquelle un Retour s'ouvre à côté de la liste. */
const LARGEUR_VOLETS = '(min-width: 1200px)';

/** La Boîte de réception, et le Retour ouvert : à côté de la liste si l'écran le permet. */
export function Retours() {
  const large = useMediaQuery(LARGEUR_VOLETS);
  const ouvert = useMatch('/retours/:id')?.params.id;
  if (ouvert && !large) return <Outlet />;
  return <BoiteDeReception ouvert={large ? ouvert : undefined} />;
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

/**
 * Boîte de réception : les Retours de tous les Projets ; les filtres vivent dans l'URL.
 * `ouvert` : le Retour affiché dans le volet, à côté de la liste.
 */
function BoiteDeReception({ ouvert }: { ouvert: string | undefined }) {
  const [parametres, setParametres] = useSearchParams();
  const navigate = useNavigate();
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
  const liste: ListeState['liste'] = { ids: lignes.map((retour) => retour.id) };
  const recherche = parametres.toString() ? `?${parametres.toString()}` : '';
  const versRetour = (id: string) => `/retours/${id}${recherche}`;

  // Comme une boîte mail : J / K passent au Retour suivant / précédent, Échap ferme.
  useEffect(() => {
    if (!ouvert) return;
    const clavier = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || cible.closest('input, textarea, select')) return;
      const position = liste.ids.indexOf(ouvert);
      const aller = (id: string | undefined) => {
        if (id) void navigate(versRetour(id), { state: { liste } satisfies ListeState });
      };
      if (e.key === 'j') aller(liste.ids[position + 1]);
      else if (e.key === 'k') aller(position > 0 ? liste.ids[position - 1] : undefined);
      else if (e.key === 'Escape') void navigate(`/retours${recherche}`);
    };
    document.addEventListener('keydown', clavier);
    return () => document.removeEventListener('keydown', clavier);
  });

  const listeRetours = (
    <>
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
                  <LigneRetour
                    key={retour.id}
                    retour={retour}
                    liste={liste}
                    vers={versRetour(retour.id)}
                    ouvert={retour.id === ouvert}
                  />
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
      {ouvert ? (
        <p className="raccourcis">
          <kbd>J</kbd> <kbd>K</kbd> Retour suivant ou précédent, <kbd>Échap</kbd> fermer
        </p>
      ) : null}
    </>
  );

  return (
    <section className="boite" data-volets={Boolean(ouvert)}>
      <div className="boite-liste">
        <PageHeader titre="Boîte de réception" />
        {listeRetours}
      </div>
      {ouvert ? (
        <VoletRetour.Provider value={{ fermer: `/retours${recherche}` }}>
          <aside className="volet-retour" aria-label="Retour ouvert">
            <Outlet />
          </aside>
        </VoletRetour.Provider>
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

function LigneRetour({
  retour,
  liste,
  vers,
  ouvert,
}: {
  retour: RetourResumeVu;
  liste: ListeState['liste'];
  vers: string;
  ouvert: boolean;
}) {
  const { verdict } = retour;
  const state: ListeState = { liste };
  const lien = useRef<HTMLAnchorElement>(null);
  // Ouverte par J / K : la ligne vient dans la vue, et prend le focus s'il était dans la liste.
  useEffect(() => {
    const element = lien.current;
    if (!ouvert || !element) return;
    element.scrollIntoView?.({ block: 'nearest' });
    if (document.activeElement?.closest('.liste-retours')) element.focus();
  }, [ouvert]);
  return (
    <li className="ligne-retour" data-etat={retour.etat} data-ouvert={ouvert}>
      <JaugeGravite gravite={verdict?.gravite} />
      <p className="corps">
        <strong className="type">{verdict ? LIBELLES_TYPE[verdict.typeRetenu] : 'Non trié'}</strong>
        <Link
          ref={lien}
          to={vers}
          state={state}
          className="apercu"
          aria-current={ouvert ? 'true' : undefined}
        >
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
