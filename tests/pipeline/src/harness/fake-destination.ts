import type {
  ClasseEchec,
  DestinationAdapter,
  EnvoiASortir,
  ResultatEnvoi,
  SanteDestination,
} from '@nudge/core';

/**
 * Destination de test branchée sur le port : elle enregistre les Envois et
 * peut simuler des échecs transient, auth et permanent.
 */
export class FakeDestination implements DestinationAdapter {
  /** Les Envois livrés, dans l'ordre. */
  readonly envois: EnvoiASortir[] = [];
  /** Tous les appels à `send`, livrés ou non. */
  readonly attempts: EnvoiASortir[] = [];
  /** Nombre d'appels à `healthCheck`. */
  healthChecks = 0;
  private sends: (ResultatEnvoi | Error)[] = [];
  private held: Promise<void> | null = null;
  private health: SanteDestination[] = [];

  /**
   * Les prochains `send` rendent ces résultats, dans l'ordre (une `Error` est
   * levée telle quelle) ; ensuite, livraison.
   */
  scriptSends(...results: (ResultatEnvoi | Error)[]): void {
    this.sends.push(...results);
  }

  /** Les prochains `healthCheck` rendent ces résultats ; ensuite, joignable. */
  scriptHealth(...health: SanteDestination[]): void {
    this.health.push(...health);
  }

  /** Bloque les `send` jusqu'à l'appel de la fonction rendue (pour des appels simultanés). */
  hold(): () => void {
    let release!: () => void;
    this.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.held = null;
      release();
    };
  }

  async send(envoi: EnvoiASortir): Promise<ResultatEnvoi> {
    this.attempts.push(envoi);
    if (this.held) await this.held;
    const result = this.sends.shift() ?? {
      statut: 'livre',
      lienExterne: `https://destination.test/envois/${envoi.envoiId}`,
    };
    if (result instanceof Error) throw result;
    if (result.statut === 'livre') this.envois.push(envoi);
    return result;
  }

  async healthCheck(): Promise<SanteDestination> {
    this.healthChecks += 1;
    return this.health.shift() ?? { joignable: true };
  }
}

/** Raccourci : `fake.scriptSends(echec('transient'))`. */
export const echec = (classe: ClasseEchec, message = `échec ${classe} simulé`): ResultatEnvoi => ({
  statut: 'echec',
  classe,
  message,
});
