/**
 * Build pour la balise script, exposé en `window.Nudge` :
 *
 *   <script src="…/nudge-widget.js" data-cle="nk_pub_…" data-api="https://nudge.exemple"></script>
 *
 * Avec `data-cle` et `data-api`, le Widget se monte seul ; sans eux, l'hôte appelle
 * `Nudge.monterWidget({ cle, api, auteur, metadonnees })`.
 */
import { definirWidget, monterWidget } from './index.js';

export { definirWidget, monterWidget, NudgeWidget } from './index.js';

definirWidget();

const script = document.currentScript as HTMLScriptElement | null;
const { cle, api } = script?.dataset ?? {};
if (cle && api) {
  const monter = () => monterWidget({ cle, api });
  if (document.body) monter();
  else document.addEventListener('DOMContentLoaded', monter, { once: true });
}
