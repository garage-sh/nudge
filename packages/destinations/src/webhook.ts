import { createHmac } from 'node:crypto';
import type {
  DestinationAdapter,
  DestinationConfiguree,
  EnvoiASortir,
  ResultatEnvoi,
} from '@nudge/core';
import { definitionWebhook, type SecretsWebhook } from '@nudge/shared';
import { classerStatut, messageEchec, messageErreur } from './http.js';

export interface OptionsWebhook {
  readonly fetch?: typeof globalThis.fetch;
  /** Horloge de l'horodatage signé (tests). */
  readonly maintenant?: () => Date;
  /** Délai de réponse du récepteur, au-delà duquel l'appel est un échec transitoire. */
  readonly delaiMs?: number;
}

const DELAI_PAR_DEFAUT_MS = 10_000;

/**
 * Webhook générique (D10) : un POST JSON vers l'URL configurée, par événement :
 * - `retour` : un Retour dispatché (`essai: true` pour le bouton « tester ») ;
 * - `ping` : la sonde `healthCheck()`, à laquelle le récepteur répond en 2xx.
 *
 * En-têtes : `X-Nudge-Evenement`, `X-Nudge-Envoi` (id stable d'un Envoi : un
 * récepteur s'en sert pour ignorer une livraison retentée), `X-Nudge-Timestamp`
 * (secondes Unix) et `X-Nudge-Signature: sha256=<hex>`, HMAC-SHA256 de
 * `<timestamp>.<corps brut>` par le secret de signature de la Destination.
 *
 * Le texte du Retour part brut, tel que l'Auteur l'a écrit : c'est au récepteur de
 * l'encoder pour sa cible. Les redirections ne sont pas suivies.
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
  const delaiMs = options.delaiMs ?? DELAI_PAR_DEFAUT_MS;

  async function poster(
    evenement: 'retour' | 'ping',
    corps: unknown,
    envoiId?: string,
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
          ...(envoiId ? { 'x-nudge-envoi': envoiId } : {}),
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
    if (reponse.status >= 300 && reponse.status < 400) {
      await reponse.body?.cancel();
      return {
        statut: 'echec',
        classe: 'permanent',
        message: `HTTP ${reponse.status} : redirection refusée, configurez l'URL finale`,
      };
    }
    return {
      statut: 'echec',
      classe: classerStatut(reponse.status),
      message: await messageEchec(reponse),
    };
  }

  return {
    send: (envoi) => poster('retour', corpsRetour(envoi), envoi.envoiId),
    async healthCheck() {
      const resultat = await poster('ping', { evenement: 'ping' });
      return resultat.statut === 'livre'
        ? { joignable: true }
        : { joignable: false, classe: resultat.classe, message: resultat.message };
    },
  };
}

function corpsRetour({ envoiId, essai, projet, retour }: EnvoiASortir) {
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
      recuLe: retour.recuLe.toISOString(),
      lien: retour.lienDashboard,
    },
  };
}
