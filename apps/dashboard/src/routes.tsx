import { Navigate, Route, Routes } from 'react-router';
import { Connexion } from './screens/Connexion.js';
import { Invitation } from './screens/Invitation.js';
import { Membres } from './screens/Membres.js';
import { Projet } from './screens/Projet.js';
import { Projets } from './screens/Projets.js';
import { Retour } from './screens/Retour.js';
import { Retours } from './screens/Retours.js';
import { Setup } from './screens/Setup.js';
import { Layout } from './layout/Layout.js';
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
          <Route path="retours" element={<Retours />} />
          <Route path="retours/:id" element={<Retour />} />
          <Route path="projets" element={<Projets />} />
          <Route path="projets/:id" element={<Projet />} />
          <Route path="membres" element={<Membres />} />
          <Route path="*" element={<h1>Page introuvable</h1>} />
        </Route>
      </Route>
    </Routes>
  );
}
