import { randomUUID } from 'node:crypto';
import type {
  Auteur,
  ClasseEchec,
  ConfianceAuteur,
  Contexte,
  Gravite,
  Source,
  TypeCapture,
  TypeRetour,
} from '@nudge/shared';
import type { Alerte } from './alerte.js';

export type { ClasseEchec } from '@nudge/shared';

/**
 * Port Destination : contrat de chaque adapter (webhook, Discord, Linear…).
 * Un adapter est construit pour UNE Destination, avec sa configuration
 * déchiffrée, par un `DestinationAdapterResolver`.
 */

/**
 * La Capture jointe à un Retour, telle qu'un adapter la reçoit : l'image n'est lue
 * dans le stockage que par l'adapter qui la joint (webhook, Linear).
 */
export interface CaptureADispatcher {
  readonly contentType: TypeCapture;
  readonly octets: number;
  /** L'image ; `null` si le stockage ne l'a plus. Lève si le stockage est injoignable. */
  lire(): Promise<Uint8Array | null>;
}

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
  /** `null` : pas de Capture. Jamais transmise au Juge, seulement aux Destinations. */
  readonly capture: CaptureADispatcher | null;
  readonly recuLe: Date;
  /** « Voir le Retour » dans le dashboard ; `null` sans `NUDGE_DASHBOARD_URL` (D12). */
  readonly lienDashboard: string | null;
}

export interface EnvoiASortir {
  readonly envoiId: string;
  readonly projet: { readonly id: string; readonly nom: string };
  readonly retour: RetourADispatcher;
  /** Retour d'exemple du bouton « tester » : aucun Envoi n'existe en base. */
  readonly essai: boolean;
}

export type ResultatEnvoi =
  | { readonly statut: 'livre'; readonly lienExterne: string | null }
  | { readonly statut: 'echec'; readonly classe: ClasseEchec; readonly message: string };

export type SanteDestination =
  | { readonly joignable: true }
  | { readonly joignable: false; readonly classe: ClasseEchec; readonly message: string };

export interface DestinationAdapter {
  send(envoi: EnvoiASortir): Promise<ResultatEnvoi>;
  /**
   * Prévient les Membres (Destination d'alerte de l'Instance) : même cible, mêmes
   * identifiants et même classification des échecs qu'un Envoi.
   */
  alerter(alerte: Alerte): Promise<ResultatEnvoi>;
  healthCheck(): Promise<SanteDestination>;
}

/** Une Destination telle que lue en base, secrets déchiffrés. */
export interface DestinationConfiguree {
  readonly id: string;
  /** `null` : la Destination d'alerte, qui appartient à l'Instance et non à un Projet. */
  readonly projetId: string | null;
  readonly nom: string;
  /** Clé de l'adapter : `webhook`, `discord`, `linear`… */
  readonly type: string;
  /** Configuration non secrète, validée à l'écriture par le schéma du type (`@nudge/shared`). */
  readonly config: Readonly<Record<string, unknown>>;
  /** Secrets déchiffrés (jetons, secret de signature) : n'existent en clair qu'ici. */
  readonly secrets: Readonly<Record<string, string>>;
}

export type DestinationAdapterResolver = (destination: DestinationConfiguree) => DestinationAdapter;

/**
 * Envoie par l'adaptateur que rend `adaptateur()` : une exception, à sa construction
 * (type inconnu, secrets indéchiffrables) comme à l'envoi (réseau, bug), devient un
 * échec transitoire au lieu de remonter.
 */
export async function envoyer(
  adaptateur: () => DestinationAdapter,
  envoi: EnvoiASortir,
): Promise<ResultatEnvoi> {
  return sansException(() => adaptateur().send(envoi));
}

/** `envoyer()` pour une alerte : une exception devient un échec transitoire. */
export async function alerter(
  adaptateur: () => DestinationAdapter,
  alerte: Alerte,
): Promise<ResultatEnvoi> {
  return sansException(() => adaptateur().alerter(alerte));
}

async function sansException(appel: () => Promise<ResultatEnvoi>): Promise<ResultatEnvoi> {
  try {
    return await appel();
  } catch (erreur) {
    return {
      statut: 'echec',
      classe: 'transient',
      message: erreur instanceof Error ? erreur.message : String(erreur),
    };
  }
}

/**
 * Le Retour d'exemple que le bouton « tester » envoie à une Destination : il passe
 * par l'adaptateur comme un vrai, marqué `essai`, sans Envoi enregistré.
 */
export function envoiDEssai(projet: EnvoiASortir['projet'], maintenant = new Date()): EnvoiASortir {
  return {
    envoiId: randomUUID(),
    projet,
    essai: true,
    retour: {
      id: randomUUID(),
      texte: 'Retour d’exemple envoyé par nudge pour tester cette Destination.',
      source: 'api',
      typeRetenu: 'bug',
      gravite: 'mineure',
      incertain: false,
      auteur: null,
      contexte: {},
      capture: null,
      recuLe: maintenant,
      lienDashboard: null,
    },
  };
}
