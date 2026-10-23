import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { invitations, type Db } from '@nudge/database';
import type { InvitationCreee, InvitationVue, MembreVu } from '@nudge/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DB } from '../../infra/tokens.js';
import { generateJeton, hashJeton } from './jetons.js';
import { MembresService } from './membres.service.js';

/** Durée de validité d'un lien d'invitation. */
export const DUREE_INVITATION_MS = 7 * 24 * 60 * 60 * 1000;

const invitationInvalide = () => new NotFoundException({ erreur: 'invitation_invalide' });

/**
 * Invitation par lien, sans email (pas de SMTP en v1) : le Membre transmet le
 * lien lui-même. Le lien est à usage unique et expire.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly membres: MembresService,
  ) {}

  async create(creePar: MembreVu): Promise<InvitationCreee> {
    const jeton = generateJeton();
    const expireLe = new Date(Date.now() + DUREE_INVITATION_MS);
    await this.db
      .insert(invitations)
      .values({ empreinteJeton: hashJeton(jeton), creeePar: creePar.id, expireLe });
    return { jeton, expireLe: expireLe.toISOString() };
  }

  /** L'invitation encore utilisable ; 404 `invitation_invalide` sinon (inconnue, expirée, servie). */
  async read(jeton: string): Promise<InvitationVue> {
    const [invitation] = await this.db
      .select({ expireLe: invitations.expireLe })
      .from(invitations)
      .where(this.utilisable(jeton))
      .limit(1);
    if (!invitation) throw invitationInvalide();
    return { expireLe: invitation.expireLe.toISOString() };
  }

  /**
   * Consomme l'invitation et crée le Membre dans la même transaction : un email
   * déjà pris annule tout, et le lien reste utilisable.
   */
  async accept(jeton: string, email: string, motDePasse: string): Promise<MembreVu> {
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .update(invitations)
        .set({ accepteeLe: new Date() })
        .where(this.utilisable(jeton))
        .returning({ id: invitations.id });
      if (!invitation) throw invitationInvalide();
      const membre = await this.membres.create(tx, email, motDePasse);
      await tx
        .update(invitations)
        .set({ membreId: membre.id })
        .where(eq(invitations.id, invitation.id));
      return membre;
    });
  }

  private utilisable(jeton: string) {
    return and(
      eq(invitations.empreinteJeton, hashJeton(jeton)),
      isNull(invitations.accepteeLe),
      gt(invitations.expireLe, new Date()),
    );
  }
}
