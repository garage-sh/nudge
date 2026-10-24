import { toCanvas } from 'html-to-image';
import { OCTETS_CAPTURE_MAX, type TypeCapture } from './domaine.js';

/** Attribut par lequel l'hôte marque un élément toujours masqué dans les Captures. */
export const ATTRIBUT_MASQUE = 'data-nudge-mask';

/** Couleur opaque qui recouvre les éléments masqués. */
export const COULEUR_MASQUE = '#1f2328';

/** Côté des pavés du floutage, en pixels de la Capture. */
const PAVE_FLOU = 16;

/** Une zone de la Capture, en pixels de la Capture. */
export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly largeur: number;
  readonly hauteur: number;
}

/** Les éléments masqués de la page, Shadow DOM ouverts compris. */
function elementsMasques(racine: Document | ShadowRoot = document): Element[] {
  const trouves = [...racine.querySelectorAll(`[${ATTRIBUT_MASQUE}]`)];
  for (const element of racine.querySelectorAll('*')) {
    if (element.shadowRoot) trouves.push(...elementsMasques(element.shadowRoot));
  }
  return trouves;
}

/** Le parent d'un nœud, en traversant la frontière d'un Shadow DOM. */
const parentDe = (noeud: Node): Node | null =>
  noeud.parentNode instanceof ShadowRoot ? noeud.parentNode.host : noeud.parentNode;

/** Éléments dont le contenu ne passe pas par des nœuds enfants (valeur, média…). */
const REMPLACES = new Set([
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'IMG',
  'VIDEO',
  'CANVAS',
  'IFRAME',
  'SVG',
]);

/**
 * Capture la partie visible de la page, dans le navigateur, sans le Widget `exclu`.
 * Les éléments `data-nudge-mask` ne la quittent jamais en clair : leur contenu n'est
 * pas recopié dans le rendu, et leur boîte est recouverte d'un aplat opaque.
 */
export async function capturerPage(exclu: Element): Promise<HTMLCanvasElement> {
  const masques = elementsMasques();
  const ensemble = new Set<Node>(masques);
  // Boîtes relevées avant le rendu, dans le repère de la fenêtre (= de la Capture).
  const boites = masques.map((element) => element.getBoundingClientRect());
  const dansUnMasque = (noeud: Node): boolean => {
    for (let parent = parentDe(noeud); parent; parent = parentDe(parent)) {
      if (ensemble.has(parent)) return true;
    }
    return false;
  };
  const largeur = window.innerWidth;
  const hauteur = window.innerHeight;
  const racine = document.documentElement;
  const fond = getComputedStyle(document.body).backgroundColor;

  const canvas = await toCanvas(racine, {
    width: largeur,
    height: hauteur,
    pixelRatio: 1,
    backgroundColor:
      fond && fond !== 'rgba(0, 0, 0, 0)' && fond !== 'transparent' ? fond : '#ffffff',
    // La fenêtre défilée : la Capture montre ce que l'Auteur voit.
    style: {
      transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
      transformOrigin: '0 0',
    },
    filter: (noeud: Node) =>
      noeud !== exclu &&
      !dansUnMasque(noeud) &&
      !(ensemble.has(noeud) && REMPLACES.has((noeud as Element).tagName?.toUpperCase())),
    // Une image d'un autre site illisible : un pixel transparent plutôt qu'un échec.
    imagePlaceholder:
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  });

  const contexte = canvas.getContext('2d')!;
  contexte.fillStyle = COULEUR_MASQUE;
  for (const boite of boites) {
    contexte.fillRect(
      Math.floor(boite.left),
      Math.floor(boite.top),
      Math.ceil(boite.right) - Math.floor(boite.left),
      Math.ceil(boite.bottom) - Math.floor(boite.top),
    );
  }
  return canvas;
}

/**
 * Floute une zone de la Capture en pavés de couleur moyenne : le détail (texte,
 * visage) n'y survit pas, contrairement à un flou gaussien léger.
 */
export function flouterZone(canvas: HTMLCanvasElement, zone: Rectangle): void {
  const x = Math.max(0, Math.floor(zone.x));
  const y = Math.max(0, Math.floor(zone.y));
  const largeur = Math.min(canvas.width, Math.ceil(zone.x + zone.largeur)) - x;
  const hauteur = Math.min(canvas.height, Math.ceil(zone.y + zone.hauteur)) - y;
  if (largeur <= 0 || hauteur <= 0) return;
  const contexte = canvas.getContext('2d')!;
  const image = contexte.getImageData(x, y, largeur, hauteur);
  const { data } = image;
  for (let paveY = 0; paveY < hauteur; paveY += PAVE_FLOU) {
    for (let paveX = 0; paveX < largeur; paveX += PAVE_FLOU) {
      const finX = Math.min(paveX + PAVE_FLOU, largeur);
      const finY = Math.min(paveY + PAVE_FLOU, hauteur);
      const somme = [0, 0, 0, 0];
      for (let py = paveY; py < finY; py += 1) {
        for (let px = paveX; px < finX; px += 1) {
          const i = (py * largeur + px) * 4;
          for (let canal = 0; canal < 4; canal += 1) somme[canal]! += data[i + canal]!;
        }
      }
      const nombre = (finX - paveX) * (finY - paveY);
      const moyenne = somme.map((valeur) => Math.round(valeur / nombre));
      for (let py = paveY; py < finY; py += 1) {
        for (let px = paveX; px < finX; px += 1) {
          const i = (py * largeur + px) * 4;
          for (let canal = 0; canal < 4; canal += 1) data[i + canal] = moyenne[canal]!;
        }
      }
    }
  }
  contexte.putImageData(image, x, y);
}

export interface CaptureEncodee {
  readonly contentType: TypeCapture;
  /** L'image encodée en base64. */
  readonly data: string;
}

const encoder = (canvas: HTMLCanvasElement, type: TypeCapture, qualite?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, qualite));

const enBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(String(lecteur.result).replace(/^data:[^,]*,/, ''));
    lecteur.onerror = () => reject(lecteur.error ?? new Error('Capture illisible'));
    lecteur.readAsDataURL(blob);
  });

/**
 * L'image à envoyer : PNG (net pour une interface), ou JPEG de moins en moins fin si
 * le PNG dépasse la taille qu'accepte l'Instance ; `null` si rien n'y tient.
 */
export async function encoderCapture(canvas: HTMLCanvasElement): Promise<CaptureEncodee | null> {
  const essais: [TypeCapture, number?][] = [
    ['image/png'],
    ['image/jpeg', 0.85],
    ['image/jpeg', 0.6],
  ];
  for (const [contentType, qualite] of essais) {
    const blob = await encoder(canvas, contentType, qualite);
    if (blob && blob.type === contentType && blob.size <= OCTETS_CAPTURE_MAX) {
      return { contentType, data: await enBase64(blob) };
    }
  }
  return null;
}
