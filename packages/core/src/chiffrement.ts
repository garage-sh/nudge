import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Clé d'Instance (D7) : 32 octets en base64, fournie par l'environnement et jamais
 * stockée en base. Générer : `openssl rand -base64 32`.
 */
export const VARIABLE_CLE_CHIFFREMENT = 'NUDGE_ENCRYPTION_KEY';

const ALGORITHME = 'aes-256-gcm';
const VERSION = 'v1';
const OCTETS_CLE = 32;
const OCTETS_IV = 12;

/** Un secret chiffré illisible : mauvaise clé, autre usage, valeur altérée ou mal formée. */
export class ErreurDechiffrement extends Error {
  override readonly name = 'ErreurDechiffrement';
}

/**
 * Chiffre les secrets stockés en base (clé du Juge, jetons des Destinations, secrets
 * HMAC). Le `contexte` nomme l'usage du secret (`parametres_instance.juge_cle`,
 * `destination.<id>.jeton`…) : il est authentifié avec lui, si bien qu'un secret
 * recopié dans une autre colonne ou une autre ligne ne se déchiffre pas.
 */
export interface Chiffreur {
  /** `v1:<iv>:<tag>:<données>`, en base64. */
  chiffrer(clair: string, contexte: string): string;
  /** Lève `ErreurDechiffrement` si le secret ne se déchiffre pas pour ce contexte. */
  dechiffrer(chiffre: string, contexte: string): string;
}

/** Lève si la clé n'est pas 32 octets en base64. */
export function chiffreurDepuisCle(cleBase64: string): Chiffreur {
  const cle = Buffer.from(cleBase64, 'base64');
  if (cle.length !== OCTETS_CLE) {
    throw new Error(
      `${VARIABLE_CLE_CHIFFREMENT} doit contenir 32 octets en base64 (${cle.length} lus) : openssl rand -base64 32`,
    );
  }
  return {
    chiffrer(clair, contexte) {
      const iv = randomBytes(OCTETS_IV);
      const chiffreur = createCipheriv(ALGORITHME, cle, iv);
      chiffreur.setAAD(Buffer.from(contexte, 'utf8'));
      const donnees = Buffer.concat([chiffreur.update(clair, 'utf8'), chiffreur.final()]);
      return [VERSION, iv, chiffreur.getAuthTag(), donnees]
        .map((partie) => (typeof partie === 'string' ? partie : partie.toString('base64')))
        .join(':');
    },
    dechiffrer(chiffre, contexte) {
      const [version, iv, tag, donnees, ...reste] = chiffre.split(':');
      if (version !== VERSION || !iv || !tag || donnees === undefined || reste.length > 0) {
        throw new ErreurDechiffrement('Secret chiffré mal formé');
      }
      try {
        const dechiffreur = createDecipheriv(ALGORITHME, cle, Buffer.from(iv, 'base64'));
        dechiffreur.setAAD(Buffer.from(contexte, 'utf8'));
        dechiffreur.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([
          dechiffreur.update(Buffer.from(donnees, 'base64')),
          dechiffreur.final(),
        ]).toString('utf8');
      } catch (cause) {
        throw new ErreurDechiffrement(
          `Secret indéchiffrable (« ${contexte} ») : autre clé d'Instance, autre usage ou valeur altérée`,
          { cause },
        );
      }
    },
  };
}
