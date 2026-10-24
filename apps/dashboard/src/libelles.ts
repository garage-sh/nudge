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

export const LIBELLES_FOURNISSEUR_JUGE: Record<FournisseurJuge, string> = {
  typesafe: 'TypeSafe (Jev)',
  openrouter: 'OpenRouter (pplx-decider)',
  auto_heberge: 'pplx-decider auto-hébergé (API Decisions)',
};

/** Classe d'un échec d'Envoi, telle qu'un Membre la lit. */
export const LIBELLES_CLASSE_ECHEC: Record<ClasseEchec, string> = {
  transient: 'indisponibilité passagère',
  auth: 'identifiants refusés',
  permanent: 'refusé par la Destination',
};
