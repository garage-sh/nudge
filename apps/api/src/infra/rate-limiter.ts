/**
 * Limiteur de débit en mémoire du processus, à fenêtre fixe, par clé (IP…).
 * Limite assumée : il compte par réplique d'api (pas de Redis pour ça, D8).
 */
export class RateLimiter {
  private readonly fenetres = new Map<string, { debut: number; compte: number }>();

  constructor(private readonly options: { readonly limit: number; readonly windowMs: number }) {}

  /** Compte une tentative pour `cle` ; `false` si la limite de la fenêtre est dépassée. */
  consume(cle: string, maintenant = Date.now()): boolean {
    this.purge(maintenant);
    const fenetre = this.fenetres.get(cle);
    if (!fenetre || maintenant - fenetre.debut >= this.options.windowMs) {
      this.fenetres.set(cle, { debut: maintenant, compte: 1 });
      return true;
    }
    fenetre.compte += 1;
    return fenetre.compte <= this.options.limit;
  }

  /** Oublie les fenêtres échues, pour que la table ne grossisse pas sans fin. */
  private purge(maintenant: number): void {
    if (this.fenetres.size < 1000) return;
    for (const [cle, fenetre] of this.fenetres) {
      if (maintenant - fenetre.debut >= this.options.windowMs) this.fenetres.delete(cle);
    }
  }
}
