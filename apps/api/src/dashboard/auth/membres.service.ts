import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { membres, type Db } from '@nudge/database';
import type { MembreListeVu, MembreVu } from '@nudge/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../infra/tokens.js';
import { hashMotDePasse, verifyMotDePasse } from './mot-de-passe.js';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Violation d'unicité Postgres, que drizzle la remonte telle quelle ou l'enveloppe. */
export const isUniqueViolation = (erreur: unknown): boolean => {
  const code = (e: unknown) => (e as { code?: string } | null)?.code;
  return code(erreur) === '23505' || code((erreur as { cause?: unknown })?.cause) === '23505';
};

@Injectable()
export class MembresService {
  /** Empreinte de comparaison quand l'email est inconnu : la réponse prend le même temps. */
  private empreinteLeurre: Promise<string> | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Tous les Membres de l'Instance, du plus ancien au plus récent ; jamais d'empreinte. */
  async lister(): Promise<MembreListeVu[]> {
    const lignes = await this.db
      .select({ id: membres.id, email: membres.email, createdAt: membres.createdAt })
      .from(membres)
      .orderBy(asc(membres.createdAt), asc(membres.id));
    return lignes.map(({ createdAt, ...membre }) => ({
      ...membre,
      depuis: createdAt.toISOString(),
    }));
  }

  async setupRequired(): Promise<boolean> {
    const [premier] = await this.db.select({ id: membres.id }).from(membres).limit(1);
    return !premier;
  }

  /**
   * Crée le premier Membre de l'Instance. Un verrou consultatif sérialise les
   * setups concurrents : un seul gagne, les autres trouvent le setup terminé.
   */
  async setup(email: string, motDePasse: string): Promise<MembreVu> {
    const empreinte = await hashMotDePasse(motDePasse);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('nudge:setup'))`);
      const [existant] = await tx.select({ id: membres.id }).from(membres).limit(1);
      if (existant) throw new ConflictException({ erreur: 'setup_termine' });
      return this.insert(tx, email, empreinte);
    });
  }

  /** Crée un Membre dans une transaction donnée (invitation) ; 409 si l'email est pris. */
  async create(tx: Transaction, email: string, motDePasse: string): Promise<MembreVu> {
    return this.insert(tx, email, await hashMotDePasse(motDePasse));
  }

  /** Le Membre dont les identifiants concordent, ou `null`. */
  async authenticate(email: string, motDePasse: string): Promise<MembreVu | null> {
    const [membre] = await this.db.select().from(membres).where(eq(membres.email, email)).limit(1);
    if (!membre) {
      this.empreinteLeurre ??= hashMotDePasse('leurre');
      await verifyMotDePasse(motDePasse, await this.empreinteLeurre);
      return null;
    }
    const valide = await verifyMotDePasse(motDePasse, membre.empreinteMotDePasse);
    return valide ? { id: membre.id, email: membre.email } : null;
  }

  private async insert(tx: Transaction, email: string, empreinte: string): Promise<MembreVu> {
    try {
      const [membre] = await tx
        .insert(membres)
        .values({ email, empreinteMotDePasse: empreinte })
        .returning({ id: membres.id, email: membres.email });
      if (!membre) throw new Error('Membre non créé');
      return membre;
    } catch (erreur) {
      if (isUniqueViolation(erreur)) throw new ConflictException({ erreur: 'email_deja_utilise' });
      throw erreur;
    }
  }
}
