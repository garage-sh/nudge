/**
 * Build for the script tag, exposed as `window.Nudge`:
 *
 *   <script src="…/nudge-widget.js" data-public-key="nk_pub_…" data-api="https://nudge.example"></script>
 *
 * With `data-public-key` and `data-api` (and optionally `data-locale`), the Widget mounts
 * itself; without them, the host calls
 * `Nudge.mountWidget({ publicKey, api, author, metadata, locale })`.
 */
import type { Locale } from './locales/index.js';
import { defineWidget, mountWidget } from './index.js';

export { defineWidget, mountWidget, NudgeWidget } from './index.js';

defineWidget();

const script = document.currentScript as HTMLScriptElement | null;
const { publicKey, api, locale } = script?.dataset ?? {};
if (publicKey && api) {
  const mount = () => mountWidget({ publicKey, api, locale: locale as Locale | undefined });
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
}
