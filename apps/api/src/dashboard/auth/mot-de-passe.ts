import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';
import { promisify } from 'node:util';

const deriver = promisify(argon2);

/** Paramètres argon2id recommandés par l'OWASP (19 MiB, 2 passes, 1 voie). */
const PARAMETRES = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

type Parametres = Pick<Argon2Parameters, 'memory' | 'passes' | 'parallelism' | 'tagLength'>;

const derive = (motDePasse: string, nonce: Buffer, parametres: Parametres) =>
  deriver('argon2id', { message: motDePasse, nonce, ...parametres });

/** Empreinte argon2id au format PHC : `$argon2id$v=19$m=…,t=…,p=…$<sel>$<empreinte>`. */
export async function hashMotDePasse(motDePasse: string): Promise<string> {
  const nonce = randomBytes(16);
  const empreinte = await derive(motDePasse, nonce, PARAMETRES);
  const { memory, passes, parallelism } = PARAMETRES;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${nonce.toString('base64url')}$${empreinte.toString('base64url')}`;
}

const FORMAT_PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/;

/** Compare en temps constant ; une empreinte illisible ne vérifie jamais. */
export async function verifyMotDePasse(motDePasse: string, empreintePhc: string): Promise<boolean> {
  const morceaux = FORMAT_PHC.exec(empreintePhc);
  if (!morceaux) return false;
  const [, memory, passes, parallelism, nonce, empreinte] = morceaux;
  const attendue = Buffer.from(empreinte!, 'base64url');
  const calculee = await derive(motDePasse, Buffer.from(nonce!, 'base64url'), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: attendue.length,
  });
  return timingSafeEqual(attendue, calculee);
}
