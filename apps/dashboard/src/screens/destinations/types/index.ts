import { estTypeDestination, type TypeDestination } from '@nudge/shared';
import type { FormulaireTypeDestination } from './type-destination.js';
import { formulaireWebhook } from './webhook.js';

export type { ChampsTypeProps, FormulaireTypeDestination } from './type-destination.js';

/** Un formulaire par type de `DEFINITIONS_DESTINATION` : le compilateur exige chaque entrée. */
export const FORMULAIRES_DESTINATION: {
  readonly [T in TypeDestination]: FormulaireTypeDestination<T>;
} = {
  webhook: formulaireWebhook,
};

/** Le formulaire d'un type, ou `null` pour un type que ce dashboard ne connaît pas. */
export const formulaireDe = (type: string): FormulaireTypeDestination | null =>
  estTypeDestination(type) ? FORMULAIRES_DESTINATION[type] : null;
