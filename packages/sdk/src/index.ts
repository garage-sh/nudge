/**
 * Client JS de l'API publique de nudge, pour un backend (serveur, mobile via son
 * serveur, outil de support) : il poste des Retours avec la **clé secrète** du Projet.
 * Les Retours envoyés ainsi ont la Source `api`, et l'Auteur fourni est **attesté** :
 * l'Instance fait confiance à l'identité transmise, contrairement à celle que le
 * Widget déclare depuis le navigateur. La clé secrète ne doit donc jamais quitter le
 * serveur.
 *
 * Les types viennent des schémas partagés (`@nudge/shared`) ; la validation reste
 * celle de l'Instance, qui renvoie le détail des champs refusés.
 */
import {
  PREFIXE_CLE_PUBLIQUE,
  PREFIXE_CLE_SECRETE,
  type ApiErrorBody,
  type RetourEntrant,
  type RetourRecu,
} from '@nudge/shared';

export type {
  Auteur,
  CaptureEntrante,
  Contexte,
  RetourEntrant,
  RetourRecu,
  TypeRetour,
} from '@nudge/shared';

export interface OptionsClient {
  /** URL de base de l'Instance, par exemple `https://nudge.exemple.com`. */
  readonly url: string;
  /** Clé secrète du Projet (`nk_sec_…`), affichée une fois dans le dashboard. */
  readonly cleSecrete: string;
  /** Implémentation de `fetch` à utiliser ; celle du runtime par défaut. */
  readonly fetch?: typeof fetch;
}

export interface OptionsEnvoi {
  /** Annule l'appel (délai, arrêt du processus…). */
  readonly signal?: AbortSignal;
}

export interface ClientNudge {
  /** Poste un Retour ; résout quand l'Instance l'a conservé (il attend alors son Triage). */
  envoyerRetour(retour: RetourEntrant, options?: OptionsEnvoi): Promise<RetourRecu>;
}

/**
 * Refus de l'Instance : `statut` HTTP, `code` stable de l'API (`retour_invalide`,
 * `cle_invalide`…) et, pour un Retour refusé, le détail des champs.
 */
export class ErreurNudge extends Error {
  override readonly name = 'ErreurNudge';

  constructor(
    readonly statut: number,
    readonly code: string | null,
    readonly details: ApiErrorBody['details'] = [],
  ) {
    super(`nudge a refusé le Retour (HTTP ${statut}${code ? `, ${code}` : ''})`);
  }
}

export function creerClient(options: OptionsClient): ClientNudge {
  verifierCle(options.cleSecrete);
  const fetcher = options.fetch ?? globalThis.fetch;
  const point = `${options.url.replace(/\/+$/, '')}/v1/retours`;
  return {
    async envoyerRetour(retour, { signal } = {}) {
      const reponse = await fetcher(point, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.cleSecrete}`,
        },
        body: JSON.stringify(retour),
        ...(signal ? { signal } : {}),
      });
      if (!reponse.ok) throw await erreurDe(reponse);
      return (await reponse.json()) as RetourRecu;
    },
  };
}

/**
 * Seule la clé secrète atteste l'identité de l'Auteur : une clé publique passée ici
 * serait refusée par l'Instance (pas d'Origine), et l'erreur dirait mal pourquoi.
 */
function verifierCle(cle: string): void {
  if (cle.startsWith(PREFIXE_CLE_PUBLIQUE)) {
    throw new TypeError(
      'Clé publique reçue : le SDK utilise la clé secrète du Projet (la clé publique est celle du Widget).',
    );
  }
  if (!cle.startsWith(PREFIXE_CLE_SECRETE)) {
    throw new TypeError(`Clé secrète attendue (préfixe ${PREFIXE_CLE_SECRETE}).`);
  }
}

async function erreurDe(reponse: Response): Promise<ErreurNudge> {
  const corps = (await reponse.json().catch(() => null)) as Partial<ApiErrorBody> | null;
  return new ErreurNudge(
    reponse.status,
    typeof corps?.erreur === 'string' ? corps.erreur : null,
    Array.isArray(corps?.details) ? corps.details : [],
  );
}
