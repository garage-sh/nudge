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
