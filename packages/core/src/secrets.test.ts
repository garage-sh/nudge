import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretCipher, SecretDecryptionError } from './secrets.js';

const cle = () => randomBytes(32).toString('base64');

describe('Chiffrement des secrets (clé d’Instance, AES-256-GCM)', () => {
  it('rend le secret chiffré illisible, et le rend tel quel au déchiffrement', () => {
    const chiffreur = createSecretCipher(cle());
    const chiffre = chiffreur.encrypt('sk-or-v1-secret', 'juge.cle');

    expect(chiffre).not.toContain('sk-or-v1-secret');
    expect(chiffreur.decrypt(chiffre, 'juge.cle')).toBe('sk-or-v1-secret');
  });

  it('chiffre deux fois le même secret en deux valeurs différentes', () => {
    const chiffreur = createSecretCipher(cle());
    expect(chiffreur.encrypt('même secret', 'x')).not.toBe(chiffreur.encrypt('même secret', 'x'));
  });

  it('refuse un secret chiffré pour un autre usage, ou avec une autre clé', () => {
    const chiffreur = createSecretCipher(cle());
    const chiffre = chiffreur.encrypt('jeton', 'destination.1.jeton');

    expect(() => chiffreur.decrypt(chiffre, 'destination.2.jeton')).toThrow(SecretDecryptionError);
    expect(() => createSecretCipher(cle()).decrypt(chiffre, 'destination.1.jeton')).toThrow(
      SecretDecryptionError,
    );
  });

  it('refuse un secret altéré ou mal formé', () => {
    const chiffreur = createSecretCipher(cle());
    const chiffre = chiffreur.encrypt('jeton', 'x');
    const [version, iv, tag, donnees] = chiffre.split(':');
    const altere = Buffer.from(donnees!, 'base64');
    altere[0] = altere[0]! ^ 1;

    expect(() =>
      chiffreur.decrypt([version, iv, tag, altere.toString('base64')].join(':'), 'x'),
    ).toThrow(SecretDecryptionError);
    expect(() => chiffreur.decrypt('pas-un-secret-chiffre', 'x')).toThrow(SecretDecryptionError);
  });

  it('exige une clé de 32 octets en base64, et dit laquelle', () => {
    expect(() => createSecretCipher('')).toThrow(/NUDGE_ENCRYPTION_KEY/);
    expect(() => createSecretCipher(randomBytes(16).toString('base64'))).toThrow(/32 octets/);
  });
});
