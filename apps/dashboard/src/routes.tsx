import { Navigate, Route, Routes } from 'react-router';
import { Connexion } from './ecrans/Connexion.js';
import { Invitation } from './ecrans/Invitation.js';
import { Membres } from './ecrans/Membres.js';
import { Projet } from './ecrans/Projet.js';
import { Projets } from './ecrans/Projets.js';
import { Setup } from './ecrans/Setup.js';
import { Layout } from './mise-en-page/Layout.js';
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
          <Route index element={<Navigate to="/projets" replace />} />
          <Route path="projets" element={<Projets />} />
          <Route path="projets/:id" element={<Projet />} />
          <Route path="membres" element={<Membres />} />
          <Route path="*" element={<h1>Page introuvable</h1>} />
        </Route>
      </Route>
    </Routes>
  );
}
