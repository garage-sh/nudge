import type { CaptureADispatcher, ClasseEchec } from '@nudge/core';
import { messageErreur } from './http.js';

export type CaptureLue =
  | { readonly ok: true; readonly image: { contentType: string; octets: Uint8Array } | null }
  | { readonly ok: false; readonly classe: ClasseEchec; readonly message: string };

/**
 * L'image de la Capture d'un Retour, pour un adaptateur qui la joint. Sans Capture,
 * ou si le stockage ne l'a plus, `image` est `null` : le Retour part sans elle. Un
 * stockage injoignable est un échec transitoire : l'Envoi sera retenté.
 */
export async function lireCapture(capture: CaptureADispatcher | null): Promise<CaptureLue> {
  if (!capture) return { ok: true, image: null };
  try {
    const octets = await capture.lire();
    return { ok: true, image: octets ? { contentType: capture.contentType, octets } : null };
  } catch (erreur) {
    return {
      ok: false,
      classe: 'transient',
      message: `Capture illisible : ${messageErreur(erreur)}`,
    };
  }
}
