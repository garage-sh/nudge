import type { TypeRetour } from '@nudge/shared';
import { LIBELLES_TYPE, LIMITES, TYPES_RETOUR } from './domaine.js';
import { envoyerRetour } from './envoi.js';
import { MESSAGES } from './messages.js';
import type { AuteurDeclare, Metadonnees } from './options.js';
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
      <!-- #14 : la Capture (opt-in, aperçu, floutage, data-nudge-mask) se greffe ici. -->
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
    bouton.textContent = MESSAGES.envoiEnCours;
    const resultat = await envoyerRetour(
      { cle: this.cle, api: this.api, auteur: this.#auteur, metadonnees: this.#metadonnees },
      {
        texte: texte.value,
        ...(type ? { type } : {}),
        ...(email.value ? { email: email.value } : {}),
      },
    );
    bouton.disabled = false;
    bouton.textContent = MESSAGES.envoyer;

    if (resultat.statut === 'erreur') {
      erreur.textContent = resultat.message;
      erreur.hidden = false;
      return;
    }
    form.reset();
    form.hidden = true;
    const confirmation = this.#el('.confirmation');
    confirmation.textContent = MESSAGES.envoye;
    confirmation.hidden = false;
  }
}
