import type { TypeCapture } from '@nudge/shared';

const EXTENSIONS: Record<TypeCapture, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

/** La clé d'une Capture dans le stockage : une par Retour. */
export const cleCapture = (retourId: string, contentType: TypeCapture): string =>
  `retours/${retourId}.${EXTENSIONS[contentType]}`;

/** Nom de fichier proposé au Membre qui enregistre l'image. */
export const nomFichierCapture = (retourId: string, contentType: TypeCapture): string =>
  `capture-${retourId}.${EXTENSIONS[contentType]}`;
