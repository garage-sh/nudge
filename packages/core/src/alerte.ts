import { randomUUID } from 'node:crypto';
import type { ClasseEchec } from '@nudge/shared';

/**
 * Alertes des Membres : ce qu'un adaptateur de Destination reçoit quand la Destination
 * d'alerte de l'Instance doit prévenir qu'un Retour attend une revue ou qu'une
 * Destination est Suspendue. Une alerte ne porte jamais le texte d'un Retour : un
 * Retour En revue est suspect de Manipulation, il se lit dans le dashboard.
 */

interface AlerteCommune {
  /** Stable d'un essai à l'autre : un récepteur s'en sert pour ignorer un doublon. */
  readonly id: string;
  /** Alerte d'exemple du bouton « tester ». */
  readonly essai: boolean;
  /** Moment de l'événement signalé. */
  readonly le: Date;
  readonly projet: { readonly id: string; readonly nom: string };
  /** Où agir dans le dashboard ; `null` sans `NUDGE_DASHBOARD_URL` (D12). */
  readonly lienDashboard: string | null;
}

/** Un Retour suspect de Manipulation attend la décision d'un Membre. */
export interface AlerteRetourEnRevue extends AlerteCommune {
  readonly evenement: 'retour_en_revue';
  readonly retour: { readonly id: string };
}

/** Une Destination vient de passer Suspendue ; ses Envois sont retenus. */
export interface AlerteDestinationSuspendue extends AlerteCommune {
  readonly evenement: 'destination_suspendue';
  readonly destination: {
    readonly id: string;
    readonly nom: string;
    /** `auth` : identifiants refusés ; `transient` : échecs répétés. */
    readonly classe: Exclude<ClasseEchec, 'permanent'>;
    /** Le dernier refus, tel que la cible l'a formulé : un texte externe, à encoder. */
    readonly message: string;
  };
}

export type Alerte = AlerteRetourEnRevue | AlerteDestinationSuspendue;
export type EvenementAlerte = Alerte['evenement'];

/** Une alerte mise en texte, commune aux adaptateurs qui écrivent un message. */
export interface AlertePresentee {
  /** Titre court, en texte brut (le nom du Projet ou de la Destination y figure). */
  readonly titre: string;
  /** Ce qui s'est passé et ce qu'on attend du Membre, en texte brut écrit par nudge. */
  readonly resume: string;
  /** Détails en texte brut, à encoder par chaque adaptateur pour sa cible. */
  readonly details: readonly { readonly libelle: string; readonly valeur: string }[];
}

/**
 * Le texte d'une alerte, identique pour toutes les cibles : chaque adaptateur n'en
 * fait que l'encodage (échappement, mentions, limites de longueur).
 */
export function presenterAlerte(alerte: Alerte): AlertePresentee {
  const essai = alerte.essai ? 'Essai · ' : '';
  if (alerte.evenement === 'retour_en_revue') {
    return {
      titre: `${essai}Retour en revue · ${alerte.projet.nom}`,
      resume:
        'Un Retour semble tenter d’influencer le Triage : il ne part vers aucune Destination tant qu’un Membre ne l’a pas validé ou rejeté.',
      details: [
        { libelle: 'Projet', valeur: alerte.projet.nom },
        { libelle: 'Retour', valeur: alerte.retour.id },
      ],
    };
  }
  const { destination } = alerte;
  return {
    titre: `${essai}Destination suspendue · ${destination.nom}`,
    resume:
      destination.classe === 'auth'
        ? 'La Destination refuse les identifiants de nudge : ses Envois sont retenus jusqu’à ce qu’elle les accepte de nouveau.'
        : 'La Destination échoue de façon répétée : ses Envois sont retenus, et nudge la sonde jusqu’à ce qu’elle réponde.',
    details: [
      { libelle: 'Projet', valeur: alerte.projet.nom },
      { libelle: 'Destination', valeur: destination.nom },
      { libelle: 'Dernier refus', valeur: destination.message },
    ],
  };
}

/** L'alerte d'exemple que le bouton « tester » de la Destination d'alerte envoie. */
export function alerteDEssai(maintenant = new Date()): AlerteRetourEnRevue {
  return {
    evenement: 'retour_en_revue',
    id: randomUUID(),
    essai: true,
    le: maintenant,
    projet: { id: randomUUID(), nom: 'Projet d’exemple' },
    retour: { id: randomUUID() },
    lienDashboard: null,
  };
}
