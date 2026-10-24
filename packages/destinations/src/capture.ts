import type { CaptureADispatcher, ClasseEchec } from '@nudge/core';
import type { TypeCapture } from '@nudge/shared';
import { messageErreur } from './http.js';

/** L'image d'une Capture, lue dans le stockage, prête à joindre. */
export interface ImageCapture {
  readonly contentType: TypeCapture;
  readonly octets: Uint8Array;
}

export type CaptureLue =
  | { readonly ok: true; readonly image: ImageCapture | null }
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
