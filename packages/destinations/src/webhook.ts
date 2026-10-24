import { createHmac } from 'node:crypto';
import {
  presenterAlerte,
  type Alerte,
  type DestinationAdapter,
  type DestinationConfiguree,
  type EnvoiASortir,
  type ResultatEnvoi,
} from '@nudge/core';
import { definitionWebhook, type SecretsWebhook } from '@nudge/shared';
import { lireCapture, type ImageCapture } from './capture.js';
import { DELAI_HTTP_PAR_DEFAUT_MS, echecHttp, messageErreur } from './http.js';

export interface OptionsWebhook {
  readonly fetch?: typeof globalThis.fetch;
  /** Horloge de l'horodatage signé (tests). */
  readonly maintenant?: () => Date;
  /** Délai de réponse du récepteur, au-delà duquel l'appel est un échec transitoire. */
  readonly delaiMs?: number;
}

/**
 * Webhook générique (D10) : un POST JSON vers l'URL configurée, par événement :
 * - `retour` : un Retour dispatché (`essai: true` pour le bouton « tester ») ;
 * - `alerte` : une alerte des Membres, quand le webhook est la Destination d'alerte ;
 * - `ping` : la sonde `healthCheck()`, à laquelle le récepteur répond en 2xx.
 *
 * En-têtes : `X-Nudge-Evenement`, `X-Nudge-Envoi` ou `X-Nudge-Alerte` (id stable
 * d'un Envoi ou d'une alerte : un récepteur s'en sert pour ignorer une livraison
 * retentée), `X-Nudge-Timestamp`
 * (secondes Unix) et `X-Nudge-Signature: sha256=<hex>`, HMAC-SHA256 de
 * `<timestamp>.<corps brut>` par le secret de signature de la Destination.
 *
 * Le texte du Retour part brut, tel que l'Auteur l'a écrit : c'est au récepteur de
 * l'encoder pour sa cible. La Capture, s'il y en a une, est jointe en base64
 * (`retour.capture: { contentType, data }`, `null` sinon). Les redirections ne sont
 * pas suivies.
 */
export function adaptateurWebhook(
  destination: DestinationConfiguree,
  options: OptionsWebhook = {},
): DestinationAdapter {
  const { url } = definitionWebhook.config.parse(destination.config);
  const { secretSignature } = destination.secrets as Partial<SecretsWebhook>;
  if (!secretSignature) throw new Error(`Webhook ${destination.id} sans secret de signature`);
  const fetch = options.fetch ?? globalThis.fetch;
  const maintenant = options.maintenant ?? (() => new Date());
  const delaiMs = options.delaiMs ?? DELAI_HTTP_PAR_DEFAUT_MS;

  async function poster(
    evenement: 'retour' | 'alerte' | 'ping',
    corps: unknown,
    entetesId: Readonly<Record<string, string>> = {},
  ): Promise<ResultatEnvoi> {
    const brut = JSON.stringify(corps);
    const horodatage = String(Math.floor(maintenant().getTime() / 1000));
    const signature = createHmac('sha256', secretSignature!)
      .update(`${horodatage}.${brut}`)
      .digest('hex');
    let reponse: Response;
    try {
      reponse = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(delaiMs),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'nudge-webhook',
          'x-nudge-evenement': evenement,
          ...entetesId,
          'x-nudge-timestamp': horodatage,
          'x-nudge-signature': `sha256=${signature}`,
        },
        body: brut,
      });
    } catch (erreur) {
      return { statut: 'echec', classe: 'transient', message: messageErreur(erreur) };
    }
    if (reponse.ok) {
      await reponse.body?.cancel();
      return { statut: 'livre', lienExterne: null };
    }
    return { statut: 'echec', ...(await echecHttp(reponse)) };
  }

  return {
    async send(envoi) {
      const capture = await lireCapture(envoi.retour.capture);
      if (!capture.ok) return { statut: 'echec', classe: capture.classe, message: capture.message };
      return poster('retour', corpsRetour(envoi, capture.image), {
        'x-nudge-envoi': envoi.envoiId,
      });
    },
    alerter(alerte) {
      return poster('alerte', corpsAlerte(alerte), { 'x-nudge-alerte': alerte.id });
    },
    async healthCheck() {
      const resultat = await poster('ping', { evenement: 'ping' });
      return resultat.statut === 'livre'
        ? { joignable: true }
        : { joignable: false, classe: resultat.classe, message: resultat.message };
    },
  };
}

function corpsRetour(
  { envoiId, essai, projet, retour }: EnvoiASortir,
  capture: ImageCapture | null,
) {
  return {
    evenement: 'retour',
    essai,
    envoi: { id: envoiId },
    projet: { id: projet.id, nom: projet.nom },
    retour: {
      id: retour.id,
      texte: retour.texte,
      source: retour.source,
      type: retour.typeRetenu,
      gravite: retour.gravite,
      incertain: retour.incertain,
      auteur: retour.auteur
        ? {
            id: retour.auteur.id ?? null,
            email: retour.auteur.email ?? null,
            nom: retour.auteur.nom ?? null,
            confiance: retour.auteur.confiance,
          }
        : null,
      contexte: retour.contexte,
      capture: capture
        ? {
            contentType: capture.contentType,
            data: Buffer.from(capture.octets).toString('base64'),
          }
        : null,
      recuLe: retour.recuLe.toISOString(),
      lien: retour.lienDashboard,
    },
  };
}

/** L'alerte structurée, et son texte (`titre`, `resume`) pour qui la relaie telle quelle. */
function corpsAlerte(alerte: Alerte) {
  const { titre, resume } = presenterAlerte(alerte);
  const commun = {
    id: alerte.id,
    type: alerte.evenement,
    le: alerte.le.toISOString(),
    titre,
    resume,
    projet: { id: alerte.projet.id, nom: alerte.projet.nom },
    lien: alerte.lienDashboard,
  };
  return {
    evenement: 'alerte',
    essai: alerte.essai,
    alerte:
      alerte.evenement === 'retour_en_revue'
        ? { ...commun, retour: { id: alerte.retour.id } }
        : {
            ...commun,
            destination: {
              id: alerte.destination.id,
              nom: alerte.destination.nom,
              classe: alerte.destination.classe,
              message: alerte.destination.message,
            },
          },
  };
}
