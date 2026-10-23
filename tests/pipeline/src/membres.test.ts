import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

const ADA = { email: 'ada@nudge.test', motDePasse: 'un mot de passe solide' };

describe('Membres : setup, session, invitation', () => {
  let pipeline: Pipeline;

  beforeEach(async () => {
    pipeline = await startPipeline();
  });

  afterEach(async () => {
    await pipeline?.stop();
  });

  describe('setup', () => {
    it('crée le premier Membre, le connecte, puis se ferme', async () => {
      const navigateur = pipeline.dashboard();
      expect(await navigateur.get('/api/setup')).toMatchObject({
        status: 200,
        body: { requis: true },
      });

      const setup = await navigateur.post('/api/setup', ADA);

      expect(setup).toMatchObject({ status: 201, body: { membre: { email: ADA.email } } });
      expect(await navigateur.get('/api/session')).toMatchObject({
        status: 200,
        body: { membre: { email: ADA.email } },
      });
      expect(await navigateur.get('/api/setup')).toMatchObject({ body: { requis: false } });

      const intrus = await pipeline.dashboard().post('/api/setup', {
        email: 'intrus@nudge.test',
        motDePasse: 'je prends la main',
      });
      expect(intrus).toMatchObject({ status: 409, body: { erreur: 'setup_termine' } });
    });

    it('ne crée qu’un seul premier Membre quand deux setups arrivent ensemble', async () => {
      const statuts = await Promise.all(
        ['a', 'b', 'c'].map(async (lettre) => {
          const reponse = await pipeline.dashboard().post('/api/setup', {
            email: `${lettre}@nudge.test`,
            motDePasse: 'un mot de passe solide',
          });
          return reponse.status;
        }),
      );

      expect(statuts.sort()).toEqual([201, 409, 409]);
    });

    it('refuse un email invalide ou un mot de passe trop court', async () => {
      const emailInvalide = await pipeline.dashboard().post('/api/setup', {
        email: 'pas-un-email',
        motDePasse: 'un mot de passe solide',
      });
      const motDePasseCourt = await pipeline.dashboard().post('/api/setup', {
        email: ADA.email,
        motDePasse: 'court',
      });

      expect(emailInvalide).toMatchObject({ status: 400, body: { erreur: 'requete_invalide' } });
      expect(motDePasseCourt).toMatchObject({ status: 400, body: { erreur: 'requete_invalide' } });
      expect(await pipeline.dashboard().get('/api/setup')).toMatchObject({
        body: { requis: true },
      });
    });
  });

  describe('connexion et déconnexion', () => {
    beforeEach(async () => {
      await pipeline.dashboard().post('/api/setup', ADA);
    });

    it('connecte un Membre par email et mot de passe, sans tenir compte de la casse de l’email', async () => {
      const navigateur = pipeline.dashboard();

      const connexion = await navigateur.post('/api/session', {
        email: 'Ada@Nudge.test',
        motDePasse: ADA.motDePasse,
      });

      expect(connexion).toMatchObject({ status: 200, body: { membre: { email: ADA.email } } });
      expect(await navigateur.get('/api/session')).toMatchObject({ status: 200 });
    });

    it('refuse un mauvais mot de passe ou un email inconnu, sans dire lequel', async () => {
      const mauvaisMotDePasse = await pipeline.dashboard().post('/api/session', {
        email: ADA.email,
        motDePasse: 'pas le bon mot de passe',
      });
      const emailInconnu = await pipeline.dashboard().post('/api/session', {
        email: 'inconnu@nudge.test',
        motDePasse: ADA.motDePasse,
      });

      for (const reponse of [mauvaisMotDePasse, emailInconnu]) {
        expect(reponse).toMatchObject({ status: 401, body: { erreur: 'identifiants_invalides' } });
      }
    });

    it('exige une session sur les routes du dashboard', async () => {
      const anonyme = pipeline.dashboard();
      const cookieForge = pipeline.dashboard().withSessionCookie('jeton-forge');

      for (const navigateur of [anonyme, cookieForge]) {
        expect(await navigateur.get('/api/session')).toMatchObject({
          status: 401,
          body: { erreur: 'session_requise' },
        });
        expect(await navigateur.get('/api/projets')).toMatchObject({ status: 401 });
        expect(await navigateur.post('/api/invitations')).toMatchObject({ status: 401 });
      }
    });

    it('révoque la session à la déconnexion, même rejouée avec l’ancien cookie', async () => {
      const navigateur = pipeline.dashboard();
      await navigateur.post('/api/session', ADA);
      const ancienCookie = navigateur.sessionCookie;

      const deconnexion = await navigateur.delete('/api/session');

      expect(deconnexion.status).toBe(204);
      expect(navigateur.sessionCookie).toBeNull();
      const rejeu = pipeline.dashboard().withSessionCookie(ancienCookie);
      expect(await rejeu.get('/api/session')).toMatchObject({ status: 401 });
    });
  });

  describe('protections des routes publiques', () => {
    beforeEach(async () => {
      await pipeline.dashboard().post('/api/setup', ADA);
    });

    it('refuse une écriture qui ne vient pas du dashboard (CSRF)', async () => {
      const navigateur = pipeline.dashboard();
      await navigateur.post('/api/session', ADA);
      const sansEnTete = (chemin: string, corps?: unknown) =>
        fetch(`${pipeline.url}${chemin}`, {
          method: 'POST',
          headers: {
            cookie: `nudge_session=${navigateur.sessionCookie}`,
            'content-type': 'text/plain',
          },
          body: corps === undefined ? undefined : JSON.stringify(corps),
        });

      for (const reponse of [
        await sansEnTete('/api/invitations'),
        await sansEnTete('/api/session', ADA),
      ]) {
        expect(reponse.status).toBe(403);
        expect(await reponse.json()).toMatchObject({ erreur: 'en_tete_manquant' });
      }
    });

    it('freine les tentatives de connexion répétées depuis une même adresse', async () => {
      for (let essai = 0; essai < 10; essai += 1) {
        const echec = await pipeline.dashboard().post('/api/session', {
          email: ADA.email,
          motDePasse: `essai ${essai}`,
        });
        expect(echec.status).toBe(401);
      }

      const bonMotDePasse = await pipeline.dashboard().post('/api/session', ADA);

      expect(bonMotDePasse).toMatchObject({
        status: 429,
        body: { erreur: 'trop_de_tentatives' },
      });
    });
  });

  describe('invitation', () => {
    const BOB = { email: 'bob@nudge.test', motDePasse: 'le mot de passe de bob' };

    async function inviter(): Promise<string> {
      const ada = await pipeline.signIn();
      const invitation = await ada.post<{ jeton: string; expireLe: string }>('/api/invitations');
      expect(invitation.status).toBe(201);
      return invitation.body.jeton;
    }

    it('laisse la personne invitée créer son compte depuis le lien, puis se connecter', async () => {
      const jeton = await inviter();
      const bob = pipeline.dashboard();

      expect(await bob.get(`/api/invitations/${jeton}`)).toMatchObject({
        status: 200,
        body: { expireLe: expect.any(String) },
      });
      const acceptation = await bob.post(`/api/invitations/${jeton}/acceptation`, BOB);

      expect(acceptation).toMatchObject({ status: 201, body: { membre: { email: BOB.email } } });
      expect(await bob.get('/api/session')).toMatchObject({
        body: { membre: { email: BOB.email } },
      });
      expect(await pipeline.dashboard().post('/api/session', BOB)).toMatchObject({ status: 200 });
    });

    it('ne sert qu’une fois', async () => {
      const jeton = await inviter();
      await pipeline.dashboard().post(`/api/invitations/${jeton}/acceptation`, BOB);

      const secondeFois = await pipeline.dashboard().post(`/api/invitations/${jeton}/acceptation`, {
        email: 'eve@nudge.test',
        motDePasse: 'le mot de passe de eve',
      });

      expect(secondeFois).toMatchObject({ status: 404, body: { erreur: 'invitation_invalide' } });
      expect(await pipeline.dashboard().get(`/api/invitations/${jeton}`)).toMatchObject({
        status: 404,
      });
    });

    it('expire au bout de sept jours', async () => {
      const jeton = await inviter();
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 + 60_000);

        const tardive = await pipeline
          .dashboard()
          .post(`/api/invitations/${jeton}/acceptation`, BOB);

        expect(tardive).toMatchObject({ status: 404, body: { erreur: 'invitation_invalide' } });
      } finally {
        vi.useRealTimers();
      }
    });

    it('refuse un lien inconnu', async () => {
      const inconnu = await pipeline.dashboard().post('/api/invitations/inconnu/acceptation', BOB);

      expect(inconnu).toMatchObject({ status: 404, body: { erreur: 'invitation_invalide' } });
    });

    it('refuse un email déjà pris sans consommer le lien', async () => {
      const jeton = await inviter();

      const doublon = await pipeline.dashboard().post(`/api/invitations/${jeton}/acceptation`, {
        email: 'premier@nudge.test',
        motDePasse: 'un autre mot de passe',
      });

      expect(doublon).toMatchObject({ status: 409, body: { erreur: 'email_deja_utilise' } });
      const reprise = await pipeline.dashboard().post(`/api/invitations/${jeton}/acceptation`, BOB);
      expect(reprise.status).toBe(201);
    });
  });
});
