/**
 * Styles du Widget, confinés à son Shadow DOM : les sélecteurs de l'hôte n'y entrent
 * pas, et ceux-ci n'en sortent pas. Seules les propriétés héritées traversent la
 * frontière ; chaque élément fixe donc les siennes (police, couleur, taille en `px`,
 * jamais en `rem`, qui suit la racine de l'hôte). `--nudge-accent` est le seul
 * réglage ouvert à l'hôte.
 */
export const STYLES = `
:host {
  all: initial;
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
}
.racine, .racine * {
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
  color: #1f2328;
}
.racine {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}
button {
  display: inline-block;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 14px;
  background: #ffffff;
}
button:focus-visible, textarea:focus-visible, select:focus-visible, input:focus-visible {
  outline: 2px solid var(--nudge-accent, #3b5bdb);
  outline-offset: 2px;
}
.lanceur, .envoyer {
  background: var(--nudge-accent, #3b5bdb);
  color: #ffffff;
  font-weight: 600;
}
.lanceur {
  border-radius: 999px;
  padding: 10px 18px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}
.envoyer:disabled { opacity: 0.6; cursor: progress; }
.panneau {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 340px;
  max-width: calc(100vw - 40px);
  padding: 16px;
  border: 1px solid #d0d7de;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}
.panneau[hidden], form[hidden], [hidden] { display: none; }
.entete { display: flex; align-items: center; justify-content: space-between; }
h2 { font-size: 16px; line-height: 24px; font-weight: 600; }
.fermer { padding: 2px 8px; font-size: 18px; color: #57606a; }
form { display: flex; flex-direction: column; gap: 6px; }
label { display: block; font-weight: 600; margin-top: 6px; }
textarea, select, input {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  background: #ffffff;
}
textarea { resize: vertical; min-height: 96px; }
.envoyer { margin-top: 10px; align-self: flex-end; }
.option { display: flex; align-items: center; gap: 8px; font-weight: 400; cursor: pointer; }
.option input { display: inline-block; width: auto; margin: 0; padding: 0; }
.etat-capture, .aide { color: #57606a; font-size: 13px; line-height: 18px; }
.apercu { display: flex; flex-direction: column; gap: 6px; }
.apercu[hidden] { display: none; }
.cadre { position: relative; }
canvas {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  cursor: crosshair;
  touch-action: none;
}
.selection {
  position: absolute;
  border: 2px dashed var(--nudge-accent, #3b5bdb);
  background: rgba(59, 91, 219, 0.15);
  pointer-events: none;
}
.retirer-flous { align-self: flex-start; padding: 4px 10px; border-color: #d0d7de; font-size: 13px; }
.erreur { color: #cf222e; }
.confirmation { color: #1a7f37; }
`;
