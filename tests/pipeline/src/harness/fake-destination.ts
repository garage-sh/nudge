import type {
  Alerte,
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
  /** Instant (`performance.now()`) de chaque appel à `send`, dans l'ordre de `attempts`. */
  readonly attemptTimes: number[] = [];
  /** Instant (`performance.now()`) de chaque appel à `healthCheck`, dans l'ordre. */
  readonly healthCheckTimes: number[] = [];
  /** Les alertes livrées, dans l'ordre (Destination d'alerte de l'Instance). */
  readonly alertes: Alerte[] = [];
  /** Tous les appels à `alerter`, livrés ou non. */
  readonly alertAttempts: Alerte[] = [];
  private sends: (ResultatEnvoi | Error)[] = [];
  private alerts: (ResultatEnvoi | Error)[] = [];
  private held: Promise<void> | null = null;
  private health: SanteDestination[] = [];

  /**
   * Les prochains `send` rendent ces résultats, dans l'ordre (une `Error` est
   * levée telle quelle) ; ensuite, livraison.
   */
  scriptSends(...results: (ResultatEnvoi | Error)[]): void {
    this.sends.push(...results);
  }

  /** Les prochains `alerter` rendent ces résultats, dans l'ordre ; ensuite, livraison. */
  scriptAlertes(...results: (ResultatEnvoi | Error)[]): void {
    this.alerts.push(...results);
  }

  /** Les prochains `healthCheck` rendent ces résultats ; ensuite, joignable. */
  scriptHealth(...health: SanteDestination[]): void {
    this.health.push(...health);
  }

  /** Les `healthCheck` suivants rendent joignable : le reste du script est abandonné. */
  restoreHealth(): void {
    this.health = [];
  }

  /** Nombre d'appels à `healthCheck`. */
  get healthChecks(): number {
    return this.healthCheckTimes.length;
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
    this.attemptTimes.push(performance.now());
    if (this.held) await this.held;
    const result = this.sends.shift() ?? {
      statut: 'livre',
      lienExterne: `https://destination.test/envois/${envoi.envoiId}`,
    };
    if (result instanceof Error) throw result;
    if (result.statut === 'livre') this.envois.push(envoi);
    return result;
  }

  async alerter(alerte: Alerte): Promise<ResultatEnvoi> {
    this.alertAttempts.push(alerte);
    const result = this.alerts.shift() ?? { statut: 'livre', lienExterne: null };
    if (result instanceof Error) throw result;
    if (result.statut === 'livre') this.alertes.push(alerte);
    return result;
  }

  async healthCheck(): Promise<SanteDestination> {
    this.healthCheckTimes.push(performance.now());
    return this.health.shift() ?? { joignable: true };
  }
}

/** Raccourci : `fake.scriptSends(echec('transient'))`. */
export const echec = (classe: ClasseEchec, message = `échec ${classe} simulé`): ResultatEnvoi => ({
  statut: 'echec',
  classe,
  message,
});
