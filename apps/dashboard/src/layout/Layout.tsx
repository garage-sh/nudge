import type { ProjectActivityView } from '@nudge/shared';
import { ChevronsUpDown, LogOut, Menu, Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useProjects, useProjectsActivity } from '../api/projects.js';
import { useSession, useSignOut } from '../api/session.js';
import { useT } from '../i18n/index.js';
import { Alerts } from './Alerts.js';
import { LocaleSelect } from './LocaleSelect.js';
import { ProjectAvatar } from '../screens/feedback-badges.js';
import type { NewProjectState } from '../screens/Projects.js';
import { INSTANCE_NAVIGATION, MAIN_NAVIGATION, type NavigationEntry } from './navigation.js';
import { useDocumentTitle } from './ui.js';

/**
 * Frame of the signed-in screens: sidebar (navigation, alerts, Projects, signed-in
 * Member) and the sheet, which scrolls on its own. Below 860 px, the sidebar becomes a
 * drawer.
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
        <button
          ref={menu}
          type="button"
          className="icon-button"
          aria-label={t.layout.menu}
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((o) => !o)}
        >
          <Menu className="icon" aria-hidden="true" />
        </button>
        <Brand />
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
        <div className="sidebar-head">
          <Brand />
        </div>
        <nav className="nav" aria-label={t.layout.mainNavigation}>
          {MAIN_NAVIGATION.map((entry) => (
            <NavigationLink key={entry.path} entry={entry} />
          ))}
        </nav>
        <Alerts />
        <ProjectsNavigation />
        <div className="sidebar-footer">
          <nav className="nav" aria-label={t.layout.instanceNavigation}>
            {INSTANCE_NAVIGATION.map((entry) => (
              <NavigationLink key={entry.path} entry={entry} />
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

function NavigationLink({ entry: { path, label, icon: Icon } }: { entry: NavigationEntry }) {
  const t = useT();
  return (
    <NavLink to={path}>
      <Icon className="icon" aria-hidden="true" />
      {t.layout[label]}
    </NavLink>
  );
}

/** The Projects, one click away: each Project's page leads to its Destinations. */
function ProjectsNavigation() {
  const t = useT();
  const projects = useProjects();
  const activity = useProjectsActivity();
  const { pathname } = useLocation();
  return (
    <nav className="nav-section" aria-label={t.layout.projects}>
      <div className="nav-heading">
        <NavLink to="/projects" end>
          {t.layout.projects}
        </NavLink>
        <Link
          to="/projects"
          state={{ adding: true } satisfies NewProjectState}
          className="icon-button"
          aria-label={t.projects.new}
          title={t.projects.new}
        >
          <Plus className="icon" aria-hidden="true" />
        </Link>
      </div>
      <div className="nav">
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
              <ProjectAvatar project={project} />
              <span className="nav-label">{project.name}</span>
              <ProjectCount activity={activity.data?.get(project.id)} />
            </NavLink>
          );
        })}
      </div>
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

/**
 * The signed-in Member: their email, which opens their menu (language, sign out).
 * Escape or a click elsewhere closes it, and focus returns to the button.
 */
function Account() {
  const t = useT();
  const { data: member } = useSession();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape closes the menu, not the drawer around it.
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    const menu = container.current;
    document.addEventListener('mousedown', outside);
    menu?.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      menu?.removeEventListener('keydown', escape);
    };
  }, [open]);
  const email = member?.email ?? '';
  return (
    <div className="account" ref={container}>
      {open ? (
        <div id={menuId} className="menu" role="group" aria-label={t.layout.accountMenu}>
          <p className="menu-label">{email}</p>
          <LocaleSelect />
          <hr className="menu-separator" />
          <button
            type="button"
            className="menu-item"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            <LogOut className="icon" aria-hidden="true" />
            {t.layout.signOut}
          </button>
        </div>
      ) : null}
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {email.slice(0, 1)}
        </span>
        <span className="account-email">{email}</span>
        <ChevronsUpDown className="icon" aria-hidden="true" />
      </button>
    </div>
  );
}

/** The mark's bars, on a 20-unit grid: the Severity gauge at its full level (docs/assets/logo.svg). */
const MARK_BARS = [5, 8, 11, 14].map((level, index) => ({
  x: index * 5.5,
  height: (20 * level) / 14,
}));

/** The brand: the mark, and the name. */
function Brand() {
  return (
    <span className="brand">
      <svg className="brand-mark" viewBox="0 0 20 20" aria-hidden="true">
        {MARK_BARS.map(({ x, height }) => (
          <rect key={x} x={x} y={20 - height} width={3.5} height={height} rx={1.1} />
        ))}
      </svg>
      nudge
    </span>
  );
}

/** A centered public page (setup, sign in, invitation). */
export function PublicPage({ title, children }: { title: string; children: React.ReactNode }) {
  useDocumentTitle(title);
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
