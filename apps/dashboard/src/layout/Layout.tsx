import type { ProjectActivityView } from '@nudge/shared';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useProjects, useProjectsActivity } from '../api/projects.js';
import { useSession, useSignOut } from '../api/session.js';
import { useT } from '../i18n/index.js';
import { Alerts } from './Alerts.js';
import { LocaleSelect } from './LocaleSelect.js';
import { INSTANCE_NAVIGATION, MAIN_NAVIGATION } from './navigation.js';

/**
 * Frame of the signed-in screens: sidebar (navigation, Projects, alerts, signed-in
 * Member) and content. Below 860 px, the sidebar becomes a drawer.
 */
export function Layout() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const menu = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    // The drawer takes focus; closed (Escape, backdrop), it returns it to the Menu button.
    sidebar.current?.querySelector<HTMLElement>('a, button')?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        menu.current?.focus();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  return (
    <div className="frame">
      <header className="mobile-bar">
        <Brand />
        <button
          ref={menu}
          type="button"
          className="secondary"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((o) => !o)}
        >
          {t.layout.menu}
        </button>
      </header>
      {open ? (
        <button
          type="button"
          className="backdrop"
          aria-label={t.layout.closeMenu}
          tabIndex={-1}
          onClick={() => {
            setOpen(false);
            menu.current?.focus();
          }}
        />
      ) : null}
      <aside ref={sidebar} id="sidebar" className="sidebar" data-open={open}>
        <Brand />
        <nav className="nav" aria-label={t.layout.mainNavigation}>
          {MAIN_NAVIGATION.map(({ path, label }) => (
            <NavLink key={path} to={path}>
              {t.layout[label]}
            </NavLink>
          ))}
        </nav>
        <ProjectsNavigation />
        <Alerts />
        <div className="sidebar-footer">
          <nav className="nav" aria-label={t.layout.instanceNavigation}>
            {INSTANCE_NAVIGATION.map(({ path, label }) => (
              <NavLink key={path} to={path}>
                {t.layout[label]}
              </NavLink>
            ))}
          </nav>
          <Account />
        </div>
      </aside>
      {/* Drawer open: the content behind the backdrop leaves the tab order. */}
      <main className="content" inert={open}>
        <Outlet />
      </main>
    </div>
  );
}

/** The Projects, one click away: each Project's page leads to its Destinations. */
function ProjectsNavigation() {
  const t = useT();
  const projects = useProjects();
  const activity = useProjectsActivity();
  const { pathname } = useLocation();
  return (
    <nav className="nav" aria-label={t.layout.projects}>
      <NavLink to="/projects" end className="nav-title">
        {t.layout.projects}
      </NavLink>
      {(projects.data ?? []).map((project) => {
        const base = `/projects/${encodeURIComponent(project.id)}`;
        const current = pathname === base || pathname.startsWith(`${base}/`);
        return (
          <NavLink
            key={project.id}
            to={`${base}/destinations`}
            className={current ? 'active' : undefined}
            aria-current={current ? 'page' : undefined}
          >
            <span className="nav-label">{project.name}</span>
            <ProjectCount activity={activity.data?.get(project.id)} />
          </NavLink>
        );
      })}
    </nav>
  );
}

/** Beside a Project: its Feedback In review if any, otherwise this week's. */
function ProjectCount({ activity }: { activity: ProjectActivityView | undefined }) {
  const t = useT();
  if (!activity) return null;
  if (activity.feedbacksInReview > 0) {
    return (
      <span className="nav-count review" title={t.layout.inReviewTitle}>
        <span className="visually-hidden">{t.layout.inReviewHidden}</span>
        {activity.feedbacksInReview}
      </span>
    );
  }
  if (activity.feedbacksThisWeek === 0) return null;
  return (
    <span className="nav-count" title={t.layout.thisWeekTitle}>
      <span className="visually-hidden">{t.layout.thisWeekHidden}</span>
      {activity.feedbacksThisWeek}
    </span>
  );
}

function Account() {
  const t = useT();
  const { data: member } = useSession();
  const signOut = useSignOut();
  return (
    <div className="account">
      <span>{member?.email}</span>
      <LocaleSelect />
      <button
        type="button"
        className="secondary"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        {t.layout.signOut}
      </button>
    </div>
  );
}

/** The brand: the full Severity gauge, and the name. */
function Brand() {
  return (
    <span className="brand">
      <span className="gauge" data-level="4" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      nudge
    </span>
  );
}

/** A centered public page (setup, sign in, invitation). */
export function PublicPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="public">
      <div className="card">
        <Brand />
        <h1>{title}</h1>
        {children}
        <LocaleSelect />
      </div>
    </main>
  );
}
