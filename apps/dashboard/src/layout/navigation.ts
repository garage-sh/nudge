/**
 * Entrées de la barre latérale, dans l'ordre. `principale` ouvre la barre (le travail
 * quotidien), `instance` la ferme (l'administration). Les Projets s'insèrent entre les
 * deux, lus depuis l'API. Un nouvel écran de premier niveau s'ajoute ici et dans
 * `routes.tsx`.
 */
export interface EntreeNavigation {
  readonly chemin: string;
  readonly libelle: string;
}

export const NAVIGATION_PRINCIPALE: readonly EntreeNavigation[] = [
  { chemin: '/retours', libelle: 'Boîte de réception' },
];

export const NAVIGATION_INSTANCE: readonly EntreeNavigation[] = [
  { chemin: '/membres', libelle: 'Membres' },
  { chemin: '/parametres', libelle: 'Paramètres' },
];
