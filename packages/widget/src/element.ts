import type { TypeRetour } from '@nudge/shared';
import { capturerPage, encoderCapture, flouterZone, type Rectangle } from './capture.js';
import { LIBELLES_TYPE, LIMITES, TYPES_RETOUR } from './domaine.js';
import { posterRetour } from './soumission.js';
import { MESSAGES } from './messages.js';
import type { AuteurDeclare, Metadonnees, OptionsWidget } from './options.js';
import { STYLES } from './styles.js';

/** Nom de l'élément : `<nudge-widget cle="nk_pub_…" api="https://nudge.exemple">`. */
export const NOM_ELEMENT = 'nudge-widget';

const GABARIT = `
<div class="racine">
  <section class="panneau" role="dialog" aria-labelledby="titre" hidden>
    <div class="entete">
      <h2 id="titre">${MESSAGES.titre}</h2>
      <button type="button" class="fermer" aria-label="${MESSAGES.fermer}">×</button>
    </div>
    <form novalidate>
      <label for="texte">${MESSAGES.texte}</label>
      <textarea id="texte" name="texte" rows="5" maxlength="${LIMITES.texte}"></textarea>
      <label for="type">${MESSAGES.type}</label>
      <select id="type" name="type">
        <option value="">${MESSAGES.typeNonPrecise}</option>
        ${TYPES_RETOUR.map((type) => `<option value="${type}">${LIBELLES_TYPE[type]}</option>`).join('')}
      </select>
      <label for="email">${MESSAGES.email}</label>
      <input id="email" name="email" type="email" autocomplete="email" maxlength="${LIMITES.email}">
      <label class="option"><input type="checkbox" name="capture">${MESSAGES.joindreCapture}</label>
      <p class="etat-capture" hidden>${MESSAGES.captureEnCours}</p>
      <div class="apercu" hidden>
        <p class="aide">${MESSAGES.aideCapture}</p>
        <div class="cadre">
          <canvas role="img" aria-label="${MESSAGES.apercuCapture}"></canvas>
          <div class="selection" hidden></div>
        </div>
        <button type="button" class="retirer-flous">${MESSAGES.retirerFlous}</button>
      </div>
      <p class="erreur" role="alert" hidden></p>
      <button type="submit" class="envoyer">${MESSAGES.envoyer}</button>
    </form>
    <p class="confirmation" role="status" hidden></p>
  </section>
  <button type="button" class="lanceur" aria-expanded="false">${MESSAGES.lanceur}</button>
</div>`;

// Hors navigateur (rendu serveur d'une app React), la classe reste importable.
const ElementHtml = (
  typeof HTMLElement === 'undefined' ? class {} : HTMLElement
) as typeof HTMLElement;

const PROPRIETES = ['cle', 'api', 'auteur', 'metadonnees'] as const;

/**
 * Le Widget : un bouton toujours accessible qui ouvre un formulaire de Retour, le
 * tout dans un Shadow DOM. Attributs `cle` et `api` ; propriétés `auteur` et
 * `metadonnees` pour l'identité et le contexte fournis par l'hôte.
 */
export class NudgeWidget extends ElementHtml {
  #auteur: AuteurDeclare | undefined;
  #metadonnees: Metadonnees | undefined;
  readonly #racine: ShadowRoot;
  /**
   * La Capture que l'Auteur a choisi de joindre : l'image masquée d'origine, que
   * « Retirer les flous » rétablit dans l'aperçu (qui porte, lui, les flous tracés).
   */
  #capture: ImageData | null = null;
  /** La Capture en train d'être prise ; l'envoi l'attend. */
  #captureEnCours: Promise<void> | null = null;
  /** Le coin de départ du rectangle que l'Auteur trace sur l'aperçu, en pixels de la Capture. */
  #trace: { x: number; y: number } | null = null;

  constructor() {
    super();
    this.#racine = this.attachShadow({ mode: 'open' });
    this.#racine.innerHTML = `<style>${STYLES}</style>${GABARIT}`;
    this.#el('.lanceur').addEventListener('click', () => this.#basculer());
    this.#el('.fermer').addEventListener('click', () => this.#fermer());
    this.#el('.panneau').addEventListener('keydown', (evenement) => {
      if ((evenement as KeyboardEvent).key === 'Escape') this.#fermer();
    });
    this.#el<HTMLTextAreaElement>('textarea').addEventListener('input', (evenement) =>
      (evenement.target as HTMLTextAreaElement).setCustomValidity(''),
    );
    this.#el<HTMLInputElement>('input[name="capture"]').addEventListener('change', (evenement) => {
      if ((evenement.target as HTMLInputElement).checked) {
        this.#captureEnCours = this.#prendreCapture();
      } else {
        this.#retirerCapture();
      }
    });
    this.#brancherFloutage();
    this.#el('form').addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      void this.#soumettre();
    });
    // Une propriété posée avant la définition de l'élément masquerait l'accesseur.
    for (const propriete of PROPRIETES) {
      if (Object.hasOwn(this, propriete)) {
        const valeur: unknown = this[propriete];
        delete this[propriete];
        Object.assign(this, { [propriete]: valeur });
      }
    }
  }

  get cle(): string {
    return this.getAttribute('cle') ?? '';
  }
  set cle(valeur: string) {
    this.setAttribute('cle', valeur);
  }

  get api(): string {
    return this.getAttribute('api') ?? '';
  }
  set api(valeur: string) {
    this.setAttribute('api', valeur);
  }

  get auteur(): AuteurDeclare | undefined {
    return this.#auteur;
  }
  set auteur(valeur: AuteurDeclare | undefined) {
    this.#auteur = valeur;
  }

  get metadonnees(): Metadonnees | undefined {
    return this.#metadonnees;
  }
  set metadonnees(valeur: Metadonnees | undefined) {
    this.#metadonnees = valeur;
  }

  /** Pose d'un coup la clé, l'Instance, l'identité et les métadonnées de l'hôte. */
  configurer(options: OptionsWidget): void {
    this.cle = options.cle;
    this.api = options.api;
    this.#auteur = options.auteur;
    this.#metadonnees = options.metadonnees;
  }

  #el<E extends HTMLElement = HTMLElement>(selecteur: string): E {
    const element = this.#racine.querySelector<E>(selecteur);
    if (!element) throw new Error(`Widget nudge : ${selecteur} introuvable`);
    return element;
  }

  #basculer(): void {
    if (this.#el('.panneau').hidden) this.#ouvrir();
    else this.#fermer();
  }

  #ouvrir(): void {
    this.#el('.panneau').hidden = false;
    this.#el('form').hidden = false;
    this.#el('.confirmation').hidden = true;
    this.#el('.lanceur').setAttribute('aria-expanded', 'true');
    this.#el('textarea').focus();
  }

  #fermer(): void {
    this.#el('.panneau').hidden = true;
    this.#el('.lanceur').setAttribute('aria-expanded', 'false');
    this.#el('.lanceur').focus();
  }

  /** La Capture à joindre, telle que l'aperçu la montre (flous compris), ou rien. */
  async #capturePrete() {
    await this.#captureEnCours;
    const caseCapture = this.#el<HTMLInputElement>('input[name="capture"]');
    if (!caseCapture.checked || !this.#capture) return null;
    return (await encoderCapture(this.#el<HTMLCanvasElement>('canvas'))) ?? 'trop_lourde';
  }

  /** Prend la Capture de la page, sur l'accord de l'Auteur (case cochée), et l'affiche. */
  async #prendreCapture(): Promise<void> {
    const etat = this.#el('.etat-capture');
    const erreur = this.#el('.erreur');
    const caseCapture = this.#el<HTMLInputElement>('input[name="capture"]');
    erreur.hidden = true;
    etat.hidden = false;
    caseCapture.disabled = true;
    try {
      const prise = await capturerPage(this);
      // L'Auteur a pu décocher la case pendant la capture : elle ne part pas.
      if (!caseCapture.checked) return;
      const apercu = this.#el<HTMLCanvasElement>('canvas');
      apercu.width = prise.width;
      apercu.height = prise.height;
      const contexte = apercu.getContext('2d')!;
      contexte.drawImage(prise, 0, 0);
      this.#capture = contexte.getImageData(0, 0, prise.width, prise.height);
      this.#el('.apercu').hidden = false;
    } catch {
      caseCapture.checked = false;
      erreur.textContent = MESSAGES.captureEchouee;
      erreur.hidden = false;
    } finally {
      etat.hidden = true;
      caseCapture.disabled = false;
    }
  }

  #retirerCapture(): void {
    this.#capture = null;
    this.#el<HTMLInputElement>('input[name="capture"]').checked = false;
    this.#el('.apercu').hidden = true;
    const apercu = this.#el<HTMLCanvasElement>('canvas');
    apercu.width = 0;
    apercu.height = 0;
  }

  /**
   * Floutage : l'Auteur trace un rectangle sur l'aperçu (souris, doigt ou stylet), la
   * zone est floutée dans l'image qui partira ; « Retirer les flous » rend l'image
   * d'origine (masques de l'hôte compris : eux ne se retirent pas).
   */
  #brancherFloutage(): void {
    const apercu = this.#el<HTMLCanvasElement>('canvas');
    const selection = this.#el('.selection');
    const pointDeLaCapture = (evenement: PointerEvent) => {
      const boite = apercu.getBoundingClientRect();
      const echelle = apercu.width / boite.width;
      return {
        x: Math.min(Math.max(0, (evenement.clientX - boite.left) * echelle), apercu.width),
        y: Math.min(Math.max(0, (evenement.clientY - boite.top) * echelle), apercu.height),
      };
    };
    const rectangle = (a: { x: number; y: number }, b: { x: number; y: number }): Rectangle => ({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      largeur: Math.abs(a.x - b.x),
      hauteur: Math.abs(a.y - b.y),
    });
    const montrer = (zone: Rectangle) => {
      const echelle = apercu.getBoundingClientRect().width / apercu.width;
      Object.assign(selection.style, {
        left: `${zone.x * echelle}px`,
        top: `${zone.y * echelle}px`,
        width: `${zone.largeur * echelle}px`,
        height: `${zone.hauteur * echelle}px`,
      });
      selection.hidden = false;
    };
    apercu.addEventListener('pointerdown', (evenement) => {
      if (!this.#capture) return;
      evenement.preventDefault();
      apercu.setPointerCapture(evenement.pointerId);
      this.#trace = pointDeLaCapture(evenement);
      montrer(rectangle(this.#trace, this.#trace));
    });
    apercu.addEventListener('pointermove', (evenement) => {
      if (this.#trace) montrer(rectangle(this.#trace, pointDeLaCapture(evenement)));
    });
    const terminer = (evenement: PointerEvent, flouter: boolean) => {
      if (!this.#trace) return;
      const zone = rectangle(this.#trace, pointDeLaCapture(evenement));
      this.#trace = null;
      selection.hidden = true;
      if (flouter && zone.largeur >= 4 && zone.hauteur >= 4) flouterZone(apercu, zone);
    };
    apercu.addEventListener('pointerup', (evenement) => terminer(evenement, true));
    apercu.addEventListener('pointercancel', (evenement) => terminer(evenement, false));
    this.#el('.retirer-flous').addEventListener('click', () => {
      if (this.#capture) apercu.getContext('2d')!.putImageData(this.#capture, 0, 0);
    });
  }

  async #soumettre(): Promise<void> {
    const form = this.#el<HTMLFormElement>('form');
    const texte = this.#el<HTMLTextAreaElement>('textarea');
    const email = this.#el<HTMLInputElement>('input[name="email"]');
    const type = this.#el<HTMLSelectElement>('select').value as TypeRetour | '';
    const erreur = this.#el('.erreur');
    const bouton = this.#el<HTMLButtonElement>('.envoyer');
    texte.setCustomValidity(texte.value.trim() ? '' : MESSAGES.texteVide);
    if (!form.reportValidity()) return;

    erreur.hidden = true;
    bouton.disabled = true;
    bouton.textContent = MESSAGES.soumissionEnCours;
    const resultat = await this.#capturePrete().then(async (capture) =>
      capture === 'trop_lourde'
        ? ({ statut: 'erreur', message: MESSAGES.captureTropLourde } as const)
        : posterRetour(
            { cle: this.cle, api: this.api, auteur: this.#auteur, metadonnees: this.#metadonnees },
            {
              texte: texte.value,
              ...(type ? { type } : {}),
              ...(email.value ? { email: email.value } : {}),
              ...(capture ? { capture } : {}),
            },
          ),
    );
    bouton.disabled = false;
    bouton.textContent = MESSAGES.envoyer;

    if (resultat.statut === 'erreur') {
      erreur.textContent = resultat.message;
      erreur.hidden = false;
      return;
    }
    form.reset();
    this.#retirerCapture();
    form.hidden = true;
    const confirmation = this.#el('.confirmation');
    confirmation.textContent = MESSAGES.envoye;
    confirmation.hidden = false;
  }
}
