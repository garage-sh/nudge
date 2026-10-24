/** Message lisible d'une valeur levée : le message d'une `Error`, sinon sa forme texte. */
export const messageErreur = (erreur: unknown): string =>
  erreur instanceof Error ? erreur.message : String(erreur);
