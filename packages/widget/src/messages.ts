/** Textes montrés à l'Auteur. */
export const MESSAGES = {
  lanceur: 'Laisser un retour',
  titre: 'Laisser un retour',
  fermer: 'Fermer',
  texte: 'Votre message',
  texteVide: 'Écrivez votre message avant d’envoyer.',
  type: 'Type (facultatif)',
  typeNonPrecise: 'Non précisé',
  email: 'Email (facultatif)',
  envoyer: 'Envoyer',
  soumissionEnCours: 'Envoi…',
  envoye: 'Merci ! Votre retour a bien été envoyé.',
  reseau: 'Envoi impossible : vérifiez votre connexion, puis réessayez.',
  invalide: 'Votre retour n’a pas été accepté : vérifiez le message et l’email, puis réessayez.',
  indisponible: 'Le service de retours est momentanément indisponible. Réessayez plus tard.',
  configuration: 'Le formulaire de retour est mal configuré : votre retour n’a pas pu être envoyé.',
} as const;

/** 429 : quand réessayer, d'après `Retry-After` (en secondes) s'il est lisible. */
export function messageLimite(retryAfter: string | null): string {
  const secondes = Number(retryAfter);
  const delai =
    !retryAfter || !Number.isFinite(secondes) || secondes <= 0
      ? 'dans quelques minutes'
      : secondes <= 60
        ? 'dans une minute'
        : `dans ${Math.ceil(secondes / 60)} minutes`;
  return `Trop de retours envoyés en peu de temps. Réessayez ${delai}.`;
}
