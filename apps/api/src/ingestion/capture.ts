import { nomFichierCapture, type TypeCapture } from '@nudge/shared';

/** La clé d'une Capture dans le stockage : une par Retour. */
export const cleCapture = (retourId: string, contentType: TypeCapture): string =>
  `retours/${nomFichierCapture(retourId, contentType)}`;
