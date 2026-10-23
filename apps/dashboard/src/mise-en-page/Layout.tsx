import { NavLink, Outlet } from 'react-router';
import { useDeconnexion, useSession } from '../api/session.js';
import { NAVIGATION } from './navigation.js';

/** Cadre des écrans connectés : en-tête, navigation, Membre connecté, déconnexion. */
export function Layout() {
  const { data: membre } = useSession();
  const deconnexion = useDeconnexion();
  return (
    <div className="cadre">
      <header className="entete">
        <span className="marque">nudge</span>
        <nav aria-label="Navigation principale">
          {NAVIGATION.map(({ chemin, libelle }) => (
            <NavLink key={chemin} to={chemin}>
              {libelle}
            </NavLink>
          ))}
        </nav>
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
      </header>
      <main className="contenu">
        <Outlet />
      </main>
    </div>
  );
}

/** Page publique centrée (setup, connexion, invitation). */
export function PagePublique({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <main className="publique">
      <div className="carte">
        <p className="marque">nudge</p>
        <h1>{titre}</h1>
        {children}
      </div>
    </main>
  );
}
