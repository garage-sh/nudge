import type {
  ClasseEchec,
  ConfianceAuteur,
  EtatDestination,
  EtatRetour,
  FournisseurJuge,
  Source,
  StatutEnvoi,
} from '@nudge/shared';

/** Libellés affichés des valeurs du domaine (vocabulaire de CONTEXT.md). */

export { LIBELLES_GRAVITE, LIBELLES_TYPE } from '@nudge/shared';

export const LIBELLES_ETAT: Record<EtatRetour, string> = {
  recu: 'Reçu',
  trie: 'Trié',
  dispatche: 'Dispatché',
  ecarte: 'Écarté',
  en_revue: 'En revue',
};

export const LIBELLES_SOURCE: Record<Source, string> = {
  widget: 'Widget',
  api: 'API',
  extension: 'Extension',
};

export const LIBELLES_CONFIANCE: Record<ConfianceAuteur, string> = {
  declaree: 'Déclarée',
  attestee: 'Attestée',
};

export const LIBELLES_STATUT_ENVOI: Record<StatutEnvoi, string> = {
  en_attente: 'En attente',
  livre: 'Livré',
  echec: 'Échec',
  retenu: 'Retenu',
};

export const LIBELLES_ETAT_DESTINATION: Record<EtatDestination, string> = {
  active: 'Active',
  suspendue: 'Suspendue',
};

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export const formatDate = (iso: string): string => FORMAT_DATE.format(new Date(iso));

const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' });
const FORMAT_JOUR_COURT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const FORMAT_JOUR_LONG = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;

/** Minuit du jour de `date`, pour comparer des jours calendaires. */
const debutDuJour = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const ecartEnJours = (date: Date, maintenant: Date): number =>
  Math.round((debutDuJour(maintenant) - debutDuJour(date)) / (24 * HEURE));

/**
 * Une date relative, pour les listes : « à l'instant », « il y a 5 min », « il y a 3 h »
 * le jour même, puis « hier » et la date courte. La date exacte va en `title`.
 */
export function formatDateRelative(iso: string, maintenant = new Date()): string {
  const date = new Date(iso);
  const ecart = maintenant.getTime() - date.getTime();
  if (ecart < MINUTE) return 'à l’instant';
  if (ecart < HEURE) return `il y a ${Math.floor(ecart / MINUTE)} min`;
  const jours = ecartEnJours(date, maintenant);
  if (jours === 0) return `il y a ${Math.floor(ecart / HEURE)} h`;
  if (jours === 1) return `hier, ${FORMAT_HEURE.format(date)}`;
  return FORMAT_JOUR_COURT.format(date);
}

/** Le jour d'une date, pour grouper une liste : « Aujourd’hui », « Hier », « mercredi 22 octobre ». */
export function formatJour(iso: string, maintenant = new Date()): string {
  const date = new Date(iso);
  const jours = ecartEnJours(date, maintenant);
  if (jours === 0) return 'Aujourd’hui';
  if (jours === 1) return 'Hier';
  const libelle = FORMAT_JOUR_LONG.format(date);
  return libelle.charAt(0).toUpperCase() + libelle.slice(1);
}

export const LIBELLES_FOURNISSEUR_JUGE: Record<FournisseurJuge, string> = {
  typesafe: 'TypeSafe',
  openrouter: 'OpenRouter',
  auto_heberge: 'Votre serveur (API Decisions)',
};

/**
 * Ce qu'est chaque fournisseur de Juge : où tourne le modèle de décision, et lequel
 * s'y choisit. Le modèle n'est jamais le nom du fournisseur.
 */
export const DESCRIPTIONS_FOURNISSEUR_JUGE: Record<FournisseurJuge, string> = {
  typesafe: 'Les modèles de décision de TypeSafe, avec votre clé API TypeSafe.',
  openrouter:
    'Les modèles de décision proposés par OpenRouter, par son API Decisions, avec votre clé API OpenRouter.',
  auto_heberge:
    'Le modèle de décision de votre choix, servi par votre propre serveur : tout serveur qui expose l’API Decisions convient. La clé est facultative.',
};

/** Classe d'un échec d'Envoi, telle qu'un Membre la lit. */
export const LIBELLES_CLASSE_ECHEC: Record<ClasseEchec, string> = {
  transient: 'indisponibilité passagère',
  auth: 'identifiants refusés',
  permanent: 'refusé par la Destination',
};
