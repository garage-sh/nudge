import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useProjets } from '../api/projets.js';
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
  useEffect(() => setOuverte(false), [pathname]);
  useEffect(() => {
    if (!ouverte) return;
    const fermer = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuverte(false);
    };
    document.addEventListener('keydown', fermer);
    return () => document.removeEventListener('keydown', fermer);
  }, [ouverte]);

  return (
    <div className="cadre">
      <header className="barre-mobile">
        <Marque />
        <button
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
          onClick={() => setOuverte(false)}
        />
      ) : null}
      <aside id="barre-laterale" className="laterale" data-ouverte={ouverte}>
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
      <main className="contenu">
        <Outlet />
      </main>
    </div>
  );
}

/** Les Projets, en accès direct : la page de chaque Projet mène à ses Destinations. */
function NavigationProjets() {
  const projets = useProjets();
  return (
    <nav className="nav" aria-label="Projets">
      <NavLink to="/projets" end className="nav-titre">
        Projets
      </NavLink>
      {(projets.data ?? []).map((projet) => (
        <NavLink key={projet.id} to={`/projets/${encodeURIComponent(projet.id)}`}>
          {projet.nom}
        </NavLink>
      ))}
    </nav>
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
