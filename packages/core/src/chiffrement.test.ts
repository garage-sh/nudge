import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chiffreurDepuisCle, ErreurDechiffrement } from './chiffrement.js';

const cle = () => randomBytes(32).toString('base64');

describe('Chiffrement des secrets (clé d’Instance, AES-256-GCM)', () => {
  it('rend le secret chiffré illisible, et le rend tel quel au déchiffrement', () => {
    const chiffreur = chiffreurDepuisCle(cle());
    const chiffre = chiffreur.chiffrer('sk-or-v1-secret', 'juge.cle');

    expect(chiffre).not.toContain('sk-or-v1-secret');
    expect(chiffreur.dechiffrer(chiffre, 'juge.cle')).toBe('sk-or-v1-secret');
  });

  it('chiffre deux fois le même secret en deux valeurs différentes', () => {
    const chiffreur = chiffreurDepuisCle(cle());
    expect(chiffreur.chiffrer('même secret', 'x')).not.toBe(chiffreur.chiffrer('même secret', 'x'));
  });

  it('refuse un secret chiffré pour un autre usage, ou avec une autre clé', () => {
    const chiffreur = chiffreurDepuisCle(cle());
    const chiffre = chiffreur.chiffrer('jeton', 'destination.1.jeton');

    expect(() => chiffreur.dechiffrer(chiffre, 'destination.2.jeton')).toThrow(ErreurDechiffrement);
    expect(() => chiffreurDepuisCle(cle()).dechiffrer(chiffre, 'destination.1.jeton')).toThrow(
      ErreurDechiffrement,
    );
  });

  it('refuse un secret altéré ou mal formé', () => {
    const chiffreur = chiffreurDepuisCle(cle());
    const chiffre = chiffreur.chiffrer('jeton', 'x');
    const [version, iv, tag, donnees] = chiffre.split(':');
    const altere = Buffer.from(donnees!, 'base64');
    altere[0] = altere[0]! ^ 1;

    expect(() =>
      chiffreur.dechiffrer([version, iv, tag, altere.toString('base64')].join(':'), 'x'),
    ).toThrow(ErreurDechiffrement);
    expect(() => chiffreur.dechiffrer('pas-un-secret-chiffre', 'x')).toThrow(ErreurDechiffrement);
  });

  it('exige une clé de 32 octets en base64, et dit laquelle', () => {
    expect(() => chiffreurDepuisCle('')).toThrow(/NUDGE_ENCRYPTION_KEY/);
    expect(() => chiffreurDepuisCle(randomBytes(16).toString('base64'))).toThrow(/32 octets/);
  });
});
