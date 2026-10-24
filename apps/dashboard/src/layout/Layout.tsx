import type { ActiviteProjetVu } from '@nudge/shared';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useActiviteProjets, useProjets } from '../api/projets.js';
import { useDeconnexion, useSession } from '../api/session.js';
import { Alertes } from './Alertes.js';
import { NAVIGATION_INSTANCE, NAVIGATION_PRINCIPALE } from './navigation.js';

/**
 * Cadre des écrans connectés : barre latérale (navigation, Projets, alertes, Membre
 * connecté) et contenu. Sous 860 px, la barre latérale devient un tiroir.
 */
export function Layout() {
  const [ouverte, setOuverte] = useState(false);
  const { pathname } = useLocation();
  const menu = useRef<HTMLButtonElement>(null);
  const laterale = useRef<HTMLElement>(null);
  useEffect(() => setOuverte(false), [pathname]);
  useEffect(() => {
    if (!ouverte) return;
    // Le tiroir prend le focus ; fermé (Échap, voile), il le rend au bouton Menu.
    laterale.current?.querySelector<HTMLElement>('a, button')?.focus();
    const fermer = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOuverte(false);
        menu.current?.focus();
      }
    };
    document.addEventListener('keydown', fermer);
    return () => document.removeEventListener('keydown', fermer);
  }, [ouverte]);

  return (
    <div className="cadre">
      <header className="barre-mobile">
        <Marque />
        <button
          ref={menu}
          type="button"
          className="secondaire"
          aria-expanded={ouverte}
          aria-controls="barre-laterale"
          onClick={() => setOuverte((o) => !o)}
        >
          Menu
        </button>
      </header>
      {ouverte ? (
        <button
          type="button"
          className="voile"
          aria-label="Fermer le menu"
          tabIndex={-1}
          onClick={() => {
            setOuverte(false);
            menu.current?.focus();
          }}
        />
      ) : null}
      <aside ref={laterale} id="barre-laterale" className="laterale" data-ouverte={ouverte}>
        <Marque />
        <nav className="nav" aria-label="Navigation principale">
          {NAVIGATION_PRINCIPALE.map(({ chemin, libelle }) => (
            <NavLink key={chemin} to={chemin}>
              {libelle}
            </NavLink>
          ))}
        </nav>
        <NavigationProjets />
        <Alertes />
        <div className="pied">
          <nav className="nav" aria-label="Instance">
            {NAVIGATION_INSTANCE.map(({ chemin, libelle }) => (
              <NavLink key={chemin} to={chemin}>
                {libelle}
              </NavLink>
            ))}
          </nav>
          <Compte />
        </div>
      </aside>
      {/* Tiroir ouvert : le contenu derrière le voile sort de la tabulation. */}
      <main className="contenu" inert={ouverte}>
        <Outlet />
      </main>
    </div>
  );
}

/** Les Projets, en accès direct : la page de chaque Projet mène à ses Destinations. */
function NavigationProjets() {
  const projets = useProjets();
  const activite = useActiviteProjets();
  const { pathname } = useLocation();
  return (
    <nav className="nav" aria-label="Projets">
      <NavLink to="/projets" end className="nav-titre">
        Projets
      </NavLink>
      {(projets.data ?? []).map((projet) => {
        const base = `/projets/${encodeURIComponent(projet.id)}`;
        const courant = pathname === base || pathname.startsWith(`${base}/`);
        return (
          <NavLink
            key={projet.id}
            to={`${base}/destinations`}
            className={courant ? 'active' : undefined}
            aria-current={courant ? 'page' : undefined}
          >
            <span className="nav-libelle">{projet.nom}</span>
            <CompteProjet activite={activite.data?.get(projet.id)} />
          </NavLink>
        );
      })}
    </nav>
  );
}

/** À côté d'un Projet : ses Retours En revue s'il y en a, sinon ceux de la semaine. */
function CompteProjet({ activite }: { activite: ActiviteProjetVu | undefined }) {
  if (!activite) return null;
  if (activite.retoursEnRevue > 0) {
    return (
      <span className="compte-nav revue" title="Retours En revue">
        <span className="visuellement-cache">, Retours En revue : </span>
        {activite.retoursEnRevue}
      </span>
    );
  }
  if (activite.retoursSemaine === 0) return null;
  return (
    <span className="compte-nav" title="Retours reçus ces sept derniers jours">
      <span className="visuellement-cache">, Retours cette semaine : </span>
      {activite.retoursSemaine}
    </span>
  );
}

function Compte() {
  const { data: membre } = useSession();
  const deconnexion = useDeconnexion();
  return (
    <div className="compte">
      <span>{membre?.email}</span>
      <button
        type="button"
        className="secondaire"
        disabled={deconnexion.isPending}
        onClick={() => deconnexion.mutate()}
      >
        Se déconnecter
      </button>
    </div>
  );
}

/** La marque : la jauge de Gravité pleine, et le nom. */
function Marque() {
  return (
    <span className="marque">
      <span className="jauge" data-niveau="4" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      nudge
    </span>
  );
}

/** Page publique centrée (setup, connexion, invitation). */
export function PublicPage({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <main className="publique">
      <div className="carte">
        <Marque />
        <h1>{titre}</h1>
        {children}
      </div>
    </main>
  );
}
