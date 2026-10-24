/** Borné à `max` unités UTF-16, sans couper une paire de substitution, avec « … ». */
export function tronquer(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  let coupe = texte.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(coupe)) coupe = coupe.slice(0, -1);
  return `${coupe}…`;
}
