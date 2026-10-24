import { Navigate, Route, Routes } from 'react-router';
import { Connexion } from './screens/Connexion.js';
import { Destinations } from './screens/destinations/Destinations.js';
import { Invitation } from './screens/Invitation.js';
import { Membres } from './screens/Membres.js';
import { Parametres } from './screens/Parametres.js';
import { Projet } from './screens/Projet.js';
import { Projets } from './screens/Projets.js';
import { Retour } from './screens/Retour.js';
import { Retours } from './screens/Retours.js';
import { Setup } from './screens/Setup.js';
import { Layout } from './layout/Layout.js';
import { PageIntrouvable } from './screens/PageIntrouvable.js';
import { RequireSession } from './session/RequireSession.js';

/**
 * Table des routes. Un écran connecté s'ajoute sous `<Layout />` (il hérite de
 * la garde de session et du cadre) ; un écran public, au premier niveau.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/connexion" element={<Connexion />} />
      <Route path="/invitation/:jeton" element={<Invitation />} />
      <Route element={<RequireSession />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/retours" replace />} />
          {/* Un Retour s'ouvre dans la Boîte : à côté de la liste sur grand écran, seul sinon. */}
          <Route path="retours" element={<Retours />}>
            <Route path=":id" element={<Retour />} />
          </Route>
          <Route path="projets" element={<Projets />} />
          <Route path="projets/:id" element={<Projet />} />
          <Route path="projets/:id/destinations" element={<Destinations />} />
          <Route path="membres" element={<Membres />} />
          <Route path="parametres" element={<Parametres />} />
          <Route path="*" element={<PageIntrouvable />} />
        </Route>
      </Route>
    </Routes>
  );
}
