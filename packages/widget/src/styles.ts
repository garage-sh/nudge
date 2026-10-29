/**
 * Widget styles, confined to its Shadow DOM: the host's selectors do not get in, and
 * these do not get out. Only inherited properties cross the boundary; every element
 * therefore sets its own (font, color, size in `px`, never `rem`, which follows the
 * host's root). `--nudge-accent` is the only setting open to the host: the other tokens
 * are declared on `.root`, out of its reach. Motion follows an action or an appearance,
 * and is turned off under `prefers-reduced-motion`.
 */
export const STYLES = `
:host {
  all: initial;
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
}
.root {
  --n-accent: var(--nudge-accent, #3b5bdb);
  --n-accent-soft: color-mix(in srgb, var(--n-accent) 10%, #ffffff);
  --n-accent-ring: color-mix(in srgb, var(--n-accent) 28%, transparent);
  --n-text: #18181b;
  --n-muted: #61616b;
  --n-faint: #9f9fa9;
  --n-surface: #ffffff;
  --n-surface-2: #f5f5f6;
  --n-border: #e4e4e7;
  --n-border-strong: #d4d4d8;
  --n-danger: #c42b1c;
  --n-danger-soft: #fdf1f0;
  --n-success: #16a34a;
  --n-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --n-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 14px;
}
.root, .root * {
  box-sizing: border-box;
  margin: 0;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  font-weight: 400;
  font-style: normal;
  line-height: 20px;
  letter-spacing: normal;
  text-transform: none;
  text-align: left;
  color: var(--n-text);
  -webkit-font-smoothing: antialiased;
}
/* The shapes of an icon take its color, not the reset above. */
.root svg * { color: inherit; }
[hidden] { display: none !important; }
svg {
  display: block;
  flex: none;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 14px;
  background: var(--n-surface);
  font-weight: 500;
  transition: background-color 140ms ease-out, border-color 140ms ease-out,
    box-shadow 140ms ease-out, transform 140ms ease-out, opacity 140ms ease-out;
}
button:focus-visible, textarea:focus-visible, input:focus-visible {
  outline: 2px solid var(--n-accent);
  outline-offset: 2px;
}

/* The launcher: a pill that arrives with the page and folds into a round close button. */
.launcher {
  gap: 0;
  height: 44px;
  padding: 0 16px 0 14px;
  border-radius: 999px;
  background: var(--n-accent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 8px 24px -6px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  animation: n-launcher-in 560ms var(--n-spring) 400ms both;
}
.launcher, .launcher * { color: #ffffff; }
.launcher:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12), 0 14px 30px -8px rgba(0, 0, 0, 0.36),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
.launcher:active { transform: scale(0.96); }
.launcher-icons { position: relative; width: 18px; height: 18px; }
.launcher-icons svg {
  position: absolute;
  inset: 0;
  transition: transform 280ms var(--n-ease), opacity 200ms ease-out;
}
.launcher:hover .icon-message { transform: rotate(-10deg) scale(1.08); }
.icon-close { opacity: 0; transform: rotate(-90deg) scale(0.5); }
.launcher-label {
  display: inline-block;
  overflow: hidden;
  max-width: 240px;
  padding-left: 8px;
  white-space: nowrap;
  font-weight: 600;
  transition: max-width 320ms var(--n-ease), padding 320ms var(--n-ease), opacity 200ms ease-out;
}
.launcher[aria-expanded='true'] { padding: 0 13px; }
.launcher[aria-expanded='true'] .launcher-label { max-width: 0; padding-left: 0; opacity: 0; }
.launcher[aria-expanded='true'] .icon-message { opacity: 0; transform: rotate(90deg) scale(0.5); }
.launcher[aria-expanded='true'] .icon-close { opacity: 1; transform: none; }

/* The panel rises from the launcher and sinks back into it. */
.panel {
  display: flex;
  flex-direction: column;
  width: 372px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 100px);
  overflow: hidden;
  border: 1px solid var(--n-border);
  border-radius: 16px;
  background: var(--n-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 24px 48px -12px rgba(0, 0, 0, 0.24);
  transform-origin: bottom right;
  animation: n-panel-in 300ms var(--n-ease);
}
.panel.closing { animation: n-panel-out 160ms ease-in forwards; }
.header { display: flex; align-items: flex-start; gap: 12px; padding: 18px 18px 14px; }
.header-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--n-accent-soft);
}
.header-mark svg { color: var(--n-accent); }
.header-text { flex: 1; min-width: 0; }
.root h2 { font-size: 16px; line-height: 22px; font-weight: 650; letter-spacing: -0.01em; }
.subtitle { margin-top: 2px; color: var(--n-muted); font-size: 13px; line-height: 18px; }
.close {
  flex: none;
  width: 30px;
  height: 30px;
  margin: -4px -6px 0 0;
  padding: 0;
  background: transparent;
}
.close svg { width: 16px; height: 16px; color: var(--n-muted); }
.close:hover { background: var(--n-surface-2); }
.body {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 2px 18px 18px;
  scrollbar-width: thin;
}
form { display: flex; flex-direction: column; gap: 14px; }
form > * { animation: n-rise 380ms var(--n-ease) both; }
form > :nth-child(2) { animation-delay: 40ms; }
form > :nth-child(3) { animation-delay: 80ms; }
form > :nth-child(4) { animation-delay: 120ms; }
form > :nth-child(n + 5) { animation-delay: 160ms; }
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 0; border: 0; }
.label, .root legend {
  display: block;
  padding: 0;
  font-size: 13px;
  line-height: 18px;
  font-weight: 550;
}

/* Feedback types: four tiles carrying a mark; clicking the chosen one clears it. */
.types { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.type { position: relative; display: block; cursor: pointer; }
.type input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 1;
}
.type-face {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 10px 2px 8px;
  border: 1px solid var(--n-border);
  border-radius: 10px;
  background: var(--n-surface);
  transition: border-color 140ms ease-out, background-color 140ms ease-out,
    box-shadow 140ms ease-out, transform 140ms ease-out;
}
.type-face svg { color: var(--n-muted); transition: color 140ms ease-out, transform 300ms var(--n-spring); }
.type-name {
  overflow: hidden;
  max-width: 100%;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: center;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--n-muted);
}
.type:hover .type-face { border-color: var(--n-border-strong); background: var(--n-surface-2); }
.type:hover .type-face svg { transform: translateY(-1px); }
.type:active .type-face { transform: scale(0.95); }
.type input:checked + .type-face {
  border-color: var(--n-accent);
  background: var(--n-accent-soft);
  box-shadow: 0 0 0 1px var(--n-accent);
}
.type input:checked + .type-face svg { color: var(--n-accent); transform: scale(1.15); }
.type input:checked + .type-face .type-name { color: var(--n-text); }
.type input:focus-visible + .type-face { outline: 2px solid var(--n-accent); outline-offset: 2px; }

textarea, input[type='email'] {
  display: block;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--n-border-strong);
  border-radius: 10px;
  background: var(--n-surface);
  transition: border-color 140ms ease-out, box-shadow 140ms ease-out;
}
textarea::placeholder, input::placeholder { color: var(--n-faint); }
textarea:hover, input[type='email']:hover { border-color: var(--n-faint); }
textarea:focus, input[type='email']:focus {
  outline: none;
  border-color: var(--n-accent);
  box-shadow: 0 0 0 3px var(--n-accent-ring);
}
textarea { resize: vertical; min-height: 92px; max-height: 280px; padding-bottom: 24px; }
.message { position: relative; }
.counter {
  position: absolute;
  right: 12px;
  bottom: 7px;
  color: var(--n-faint);
  font-size: 12px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.counter.near { color: var(--n-danger); }

/* The Capture: a card with a switch, then the preview to blur. */
.capture {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--n-border);
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 140ms ease-out;
}
.capture:hover { background: var(--n-surface-2); }
.capture-icon { color: var(--n-muted); }
.capture-text { flex: 1; min-width: 0; font-weight: 500; }
.capture input {
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  margin: 0;
  border-radius: 999px;
  background: var(--n-border-strong);
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
  transition: background-color 200ms ease-out;
}
.capture input::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform 260ms var(--n-spring);
}
.capture input:checked { background: var(--n-accent); }
.capture input:checked::after { transform: translateX(14px); }
.capture input:disabled { opacity: 0.6; cursor: progress; }
.capture-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--n-muted);
  font-size: 13px;
  line-height: 18px;
  animation: n-rise 240ms var(--n-ease) both;
}
.capture-status, .capture-status * { color: var(--n-muted); }
.spinner {
  flex: none;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: n-spin 700ms linear infinite;
}
.preview { display: flex; flex-direction: column; gap: 8px; animation: n-rise 320ms var(--n-ease) both; }
.help { color: var(--n-muted); font-size: 12px; line-height: 17px; }
.frame { position: relative; overflow: hidden; border: 1px solid var(--n-border); border-radius: 10px; }
canvas { display: block; width: 100%; height: auto; cursor: crosshair; touch-action: none; }
.selection {
  position: absolute;
  border: 2px dashed var(--n-accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--n-accent) 15%, transparent);
  pointer-events: none;
}
.clear-blurs {
  align-self: flex-start;
  padding: 4px 10px;
  border-color: var(--n-border);
  color: var(--n-muted);
  font-size: 12px;
  line-height: 18px;
}
.clear-blurs:hover { background: var(--n-surface-2); color: var(--n-text); }

.error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--n-danger-soft);
  animation: n-shake 380ms ease-out;
}
.error, .error * { color: var(--n-danger); font-size: 13px; line-height: 18px; }
.error svg { width: 16px; height: 16px; margin-top: 1px; }

.footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.shortcut { display: flex; align-items: center; gap: 4px; }
.shortcut, .shortcut * { color: var(--n-faint); font-size: 12px; line-height: 16px; }
kbd {
  padding: 1px 5px;
  border: 1px solid var(--n-border);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--n-surface-2);
  font-family: inherit;
}
.root kbd { color: var(--n-muted); font-size: 11px; line-height: 14px; }
.submit {
  height: 38px;
  padding: 0 16px;
  background: var(--n-accent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.16);
}
.submit, .submit * { color: #ffffff; font-weight: 600; }
.submit { margin-left: auto; }
.submit:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
.submit:active:not(:disabled), .again:active { transform: scale(0.97); }
.submit svg { width: 16px; height: 16px; transition: transform 220ms var(--n-ease); }
.submit:hover:not(:disabled) svg { transform: translate(2px, -2px); }
.submit:disabled { opacity: 0.8; cursor: progress; }
.submit:disabled svg { display: none; }

/* After sending: a check that draws itself, then the thanks. */
.done { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 16px 8px 6px; }
.done-mark {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--n-success) 12%, #ffffff);
  animation: n-pop 500ms var(--n-spring) both;
}
.done-mark svg { width: 28px; height: 28px; color: var(--n-success); stroke-width: 2.5; }
.done-mark path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: n-draw 420ms var(--n-ease) 240ms forwards; }
.confirmation {
  max-width: 270px;
  text-align: center;
  font-size: 15px;
  line-height: 22px;
  font-weight: 500;
  animation: n-rise 400ms var(--n-ease) 160ms both;
}
.again {
  height: 36px;
  padding: 0 14px;
  border-color: var(--n-border-strong);
  animation: n-rise 400ms var(--n-ease) 280ms both;
}
.again:hover { background: var(--n-surface-2); }

@keyframes n-launcher-in {
  from { opacity: 0; transform: translateY(18px) scale(0.8); }
  to { opacity: 1; transform: none; }
}
@keyframes n-panel-in {
  from { opacity: 0; transform: translateY(12px) scale(0.96); }
  to { opacity: 1; transform: none; }
}
@keyframes n-panel-out { to { opacity: 0; transform: translateY(10px) scale(0.97); } }
@keyframes n-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@keyframes n-pop {
  from { opacity: 0; transform: scale(0.4); }
  to { opacity: 1; transform: none; }
}
@keyframes n-draw { to { stroke-dashoffset: 0; } }
@keyframes n-spin { to { transform: rotate(360deg); } }
@keyframes n-shake {
  0%, 100% { transform: none; }
  25% { transform: translateX(-4px); }
  50% { transform: translateX(3px); }
  75% { transform: translateX(-2px); }
}

@media (max-width: 480px) {
  :host { right: 12px; bottom: 12px; }
  .panel { max-width: calc(100vw - 24px); max-height: calc(100vh - 80px); }
  .shortcut { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .root *, .root *::before, .root *::after {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
    transition-duration: 1ms !important;
  }
}
`;
