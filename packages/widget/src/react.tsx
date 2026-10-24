import { createElement, useLayoutEffect, useRef } from 'react';
import { definirWidget, NOM_ELEMENT, type NudgeWidget as ElementWidget } from './index.js';
import type { OptionsWidget } from './options.js';

export type { AuteurDeclare, Metadonnees, OptionsWidget } from './options.js';

export type NudgeWidgetProps = OptionsWidget;

/**
 * Le Widget en composant React : `<NudgeWidget cle="nk_pub_…" api="…" auteur={…} />`.
 * L'élément est monté une fois ; un changement de props met à jour ses propriétés
 * sans le recréer, de sorte qu'un formulaire en cours de saisie reste ouvert.
 */
export function NudgeWidget({ cle, api, auteur, metadonnees }: NudgeWidgetProps) {
  const ref = useRef<ElementWidget>(null);
  useLayoutEffect(() => {
    // Défini avant d'écrire les propriétés : l'élément est alors mis à niveau.
    definirWidget();
    const widget = ref.current;
    if (!widget) return;
    widget.cle = cle;
    widget.api = api;
    widget.auteur = auteur;
    widget.metadonnees = metadonnees;
  }, [cle, api, auteur, metadonnees]);
  return createElement(NOM_ELEMENT, { ref });
}
