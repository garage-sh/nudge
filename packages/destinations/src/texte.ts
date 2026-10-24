import type { EnvoiASortir } from '@nudge/core';
import { LIBELLES_TYPE } from '@nudge/shared';

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

/**
 * Titre d'une issue (Linear, GitHub) : le Type et la première ligne non vide du texte,
 * « Essai · » en tête pour le Retour d'exemple, borné à `max`.
 */
export function titreAvecType({ essai, retour }: EnvoiASortir, max: number): string {
  const ligne = premiereLigne(retour.texte);
  const entete = `${essai ? 'Essai · ' : ''}${LIBELLES_TYPE[retour.typeRetenu]}`;
  return tronquer(ligne ? `${entete} · ${ligne}` : entete, max);
}
