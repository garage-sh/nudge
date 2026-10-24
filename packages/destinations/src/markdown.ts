import { presenterAlerte, type Alerte } from '@nudge/core';

/**
 * Échappement CommonMark commun aux Destinations qui rendent du markdown (Linear,
 * GitHub) : chaque caractère de ponctuation ASCII peut être précédé d'une barre oblique
 * inverse, qui le rend littéral (https://spec.commonmark.org/0.31.2/#backslash-escapes).
 */
export const echapperPonctuation = (texte: string): string =>
  texte.replace(/[!-/:-@[-`{-~]/g, '\\$&');

/** Un lien du dashboard qu'on peut écrire tel quel entre chevrons : `[texte](<lien>)`. */
export const lienSur = (lien: string | null): lien is string =>
  lien !== null && /^https?:\/\/[^\s<>]+$/.test(lien);

/**
 * Le corps markdown d'une alerte (issue Linear, GitHub) : le résumé, chaque détail
 * en paragraphe, sa valeur passée par `echapper`, puis le lien vers le dashboard.
 */
export function alerteEnMarkdown(alerte: Alerte, echapper: (texte: string) => string): string {
  const { resume, details } = presenterAlerte(alerte);
  return [
    resume,
    ...details.map(({ libelle, valeur }) => `**${libelle}** : ${echapper(valeur)}`),
    ...(lienSur(alerte.lienDashboard) ? [`[Ouvrir dans nudge](<${alerte.lienDashboard}>)`] : []),
  ].join('\n\n');
}
