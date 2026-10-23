/**
 * Entrées de la barre de navigation, dans l'ordre. Un nouvel écran de premier
 * niveau (Destinations…) s'ajoute ici et dans `routes.tsx`.
 */
export const NAVIGATION: readonly { readonly chemin: string; readonly libelle: string }[] = [
  { chemin: '/retours', libelle: 'Boîte de réception' },
  { chemin: '/projets', libelle: 'Projets' },
  { chemin: '/membres', libelle: 'Membres' },
];
