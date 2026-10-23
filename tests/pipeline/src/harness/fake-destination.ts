import type {
  AdaptateurDestination,
  ClasseEchec,
  EnvoiASortir,
  ResultatEnvoi,
  SanteDestination,
} from '@nudge/core';

/**
 * Destination de test branchée sur le port : elle enregistre les Envois et
 * peut simuler des échecs transient, auth et permanent.
 */
export class FakeDestination implements AdaptateurDestination {
  /** Les Envois livrés, dans l'ordre. */
  readonly envois: EnvoiASortir[] = [];
  /** Tous les appels à `send`, livrés ou non. */
  readonly tentatives: EnvoiASortir[] = [];
  /** Nombre d'appels à `healthCheck`. */
  sondes = 0;
  private resultats: ResultatEnvoi[] = [];
  private sante: SanteDestination[] = [];

  /** Les prochains `send` rendent ces résultats, dans l'ordre ; ensuite, livraison. */
  scripterEnvois(...resultats: ResultatEnvoi[]): void {
    this.resultats.push(...resultats);
  }

  /** Les prochains `healthCheck` rendent ces résultats ; ensuite, joignable. */
  scripterSante(...sante: SanteDestination[]): void {
    this.sante.push(...sante);
  }

  async send(envoi: EnvoiASortir): Promise<ResultatEnvoi> {
    this.tentatives.push(envoi);
    const resultat = this.resultats.shift() ?? {
      statut: 'livre',
      lienExterne: `https://destination.test/envois/${envoi.envoiId}`,
    };
    if (resultat.statut === 'livre') this.envois.push(envoi);
    return resultat;
  }

  async healthCheck(): Promise<SanteDestination> {
    this.sondes += 1;
    return this.sante.shift() ?? { joignable: true };
  }
}

/** Raccourci : `fake.scripterEnvois(echec('transient'))`. */
export const echec = (classe: ClasseEchec, message = `échec ${classe} simulé`): ResultatEnvoi => ({
  statut: 'echec',
  classe,
  message,
});
