import { NOM_ELEMENT, NudgeWidget } from './element.js';
import type { OptionsWidget } from './options.js';

export { NOM_ELEMENT, NudgeWidget } from './element.js';
export type { AuteurDeclare, Metadonnees, OptionsWidget } from './options.js';

/** Enregistre `<nudge-widget>` (sans effet s'il l'est déjà). */
export function definirWidget(): void {
  if (!customElements.get(NOM_ELEMENT)) customElements.define(NOM_ELEMENT, NudgeWidget);
}

/** Crée le Widget avec ses options et l'ajoute à la page (`document.body` par défaut). */
export function monterWidget(options: OptionsWidget, parent: Element = document.body): NudgeWidget {
  definirWidget();
  const widget = document.createElement(NOM_ELEMENT) as NudgeWidget;
  widget.configurer(options);
  parent.append(widget);
  return widget;
}
