import { Navigate, Route, Routes } from 'react-router';
import { Destinations } from './screens/destinations/Destinations.js';
import { Feedback } from './screens/Feedback.js';
import { Feedbacks } from './screens/Feedbacks.js';
import { Incident } from './screens/Incident.js';
import { Incidents } from './screens/Incidents.js';
import { Invitation } from './screens/Invitation.js';
import { Members } from './screens/Members.js';
import { NotFound } from './screens/NotFound.js';
import { Project } from './screens/Project.js';
import { Projects } from './screens/Projects.js';
import { Settings } from './screens/Settings.js';
import { Setup } from './screens/Setup.js';
import { SignIn } from './screens/SignIn.js';
import { Layout } from './layout/Layout.js';
import { RequireSession } from './session/RequireSession.js';

/**
 * The route table. A signed-in screen goes under `<Layout />` (it inherits the session
 * guard and the frame); a public screen, at the top level.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/invitation/:token" element={<Invitation />} />
      <Route element={<RequireSession />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/feedbacks" replace />} />
          {/* A Feedback opens in the Inbox: beside the list on a large screen, alone otherwise. */}
          <Route path="feedbacks" element={<Feedbacks />}>
            <Route path=":id" element={<Feedback />} />
          </Route>
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<Project />} />
          <Route path="projects/:id/destinations" element={<Destinations />} />
          <Route path="projects/:id/incidents" element={<Incidents />} />
          <Route path="projects/:id/incidents/:incidentId" element={<Incident />} />
          <Route path="members" element={<Members />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
