import type { Auteur, ConfianceAuteur, Contexte, Gravite, Source, TypeRetour } from '@nudge/shared';

/**
 * Port Destination : contrat de chaque adapter (webhook, Discord, Linear…).
 * Un adapter est construit pour UNE Destination, avec sa configuration
 * déchiffrée, par un `DestinationAdapterResolver`.
 */

/** Ce qu'un adapter reçoit d'un Retour Trié. Le texte est brut : chaque adapter l'encode pour sa cible. */
export interface RetourADispatcher {
  readonly id: string;
  readonly texte: string;
  readonly source: Source;
  readonly typeRetenu: TypeRetour;
  /** Absente en mode dégradé (sans Juge). */
  readonly gravite: Gravite | null;
  readonly incertain: boolean;
  readonly auteur: (Auteur & { readonly confiance: ConfianceAuteur }) | null;
  readonly contexte: Contexte;
  readonly recuLe: Date;
}

export interface EnvoiASortir {
  readonly envoiId: string;
  readonly projet: { readonly id: string; readonly nom: string };
  readonly retour: RetourADispatcher;
}

/**
 * - `transient` : 5xx, 429, timeout — retenté, compte pour la Suspension ;
 * - `auth` : identifiants refusés — Suspension immédiate, sans retry ;
 * - `permanent` : refusé pour ce Retour précis — échec sans retry ni Suspension.
 */
export type ClasseEchec = 'transient' | 'auth' | 'permanent';

export type ResultatEnvoi =
  | { readonly statut: 'livre'; readonly lienExterne: string | null }
  | { readonly statut: 'echec'; readonly classe: ClasseEchec; readonly message: string };

export type SanteDestination =
  | { readonly joignable: true }
  | { readonly joignable: false; readonly classe: ClasseEchec; readonly message: string };

export interface DestinationAdapter {
  send(envoi: EnvoiASortir): Promise<ResultatEnvoi>;
  healthCheck(): Promise<SanteDestination>;
}

/** Une Destination telle que lue en base, secrets déchiffrés. */
export interface DestinationConfiguree {
  readonly id: string;
  readonly projetId: string;
  readonly nom: string;
  /** Clé de l'adapter : `webhook`, `discord`, `linear`… */
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
}

export type DestinationAdapterResolver = (destination: DestinationConfiguree) => DestinationAdapter;
