import type { Contexte, RetourEntrant, TypeRetour } from '@nudge/shared';
import { LIMITES } from './domaine.js';
import { MESSAGES, messageLimite } from './messages.js';
import type { AuteurDeclare, Metadonnees, OptionsWidget } from './options.js';

/** Ce que l'Auteur a saisi dans le formulaire. */
export interface Saisie {
  readonly texte: string;
  readonly type?: TypeRetour;
  readonly email?: string;
}

export type ResultatSoumission =
  { readonly statut: 'envoye' } | { readonly statut: 'erreur'; readonly message: string };

/**
 * Contexte relevé automatiquement : URL de la page, navigateur et OS (user-agent),
 * écran (viewport), plus les métadonnées de l'hôte. Une valeur qui dépasse les bornes
 * de l'ingestion est omise plutôt que de faire refuser le Retour.
 */
export function contexteDeLaPage(metadonnees?: Metadonnees): Contexte {
  const url = window.location.href;
  return {
    ...(url.length <= LIMITES.url ? { url } : {}),
    userAgent: navigator.userAgent.slice(0, LIMITES.userAgent),
    viewport: { largeur: window.innerWidth, hauteur: window.innerHeight },
    ...(metadonnees && Object.keys(metadonnees).length > 0
      ? { metadonnees: { ...metadonnees } }
      : {}),
  };
}

/** L'email saisi par l'Auteur l'emporte sur celui que l'hôte a déclaré. */
function auteurDuRetour(hote: AuteurDeclare | undefined, email: string | undefined) {
  const auteur = { ...hote, ...(email ? { email } : {}) };
  return Object.keys(auteur).length > 0 ? auteur : undefined;
}

/**
 * Poste le Retour sur l'API publique de l'Instance avec la clé publique du Projet
 * (Source `widget`) et traduit l'issue en message pour l'Auteur.
 */
export async function posterRetour(
  options: OptionsWidget,
  saisie: Saisie,
): Promise<ResultatSoumission> {
  const auteur = auteurDuRetour(options.auteur, saisie.email);
  // #14 : la Capture (déjà masquée et floutée dans le navigateur) rejoindra ce corps.
  const corps: RetourEntrant = {
    texte: saisie.texte,
    ...(saisie.type ? { type: saisie.type } : {}),
    ...(auteur ? { auteur } : {}),
    contexte: contexteDeLaPage(options.metadonnees),
  };
  let reponse: Response;
  try {
    reponse = await fetch(`${options.api.replace(/\/+$/, '')}/v1/retours`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.cle}` },
      body: JSON.stringify(corps),
      credentials: 'omit',
    });
  } catch {
    return erreur(MESSAGES.reseau);
  }
  if (reponse.ok) return { statut: 'envoye' };
  if (reponse.status === 429) return erreur(messageLimite(reponse.headers.get('retry-after')));
  if (reponse.status === 400) return erreur(MESSAGES.invalide);
  if (reponse.status >= 500) return erreur(MESSAGES.indisponible);
  return erreur(MESSAGES.configuration);
}

const erreur = (message: string): ResultatSoumission => ({ statut: 'erreur', message });
