/** Borné à `max` unités UTF-16, sans couper une paire de substitution, avec « … ». */
export function tronquer(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  let coupe = texte.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(coupe)) coupe = coupe.slice(0, -1);
  return `${coupe}…`;
}

/** La première ligne non vide d'un texte, espaces réduits, ou `''`. */
export const premiereLigne = (texte: string): string =>
  texte
    .split(/\r\n|\r|\n/)
    .map((ligne) => ligne.replace(/\s+/g, ' ').trim())
    .find((ligne) => ligne.length > 0) ?? '';
