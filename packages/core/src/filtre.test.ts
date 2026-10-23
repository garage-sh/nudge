import { describe, expect, it } from 'vitest';
import { filtreRetient, type Filtre } from './filtre.js';
import { renderVerdict } from './triage.js';

const bugsGraves: Filtre = { types: ['bug'], graviteMinimale: 'majeure' };
const tousLesAvis: Filtre = { types: ['avis'], graviteMinimale: null };

describe('Filtre d’une Destination', () => {
  it('retient un Retour d’un Type retenu dont la Gravité atteint la Gravité minimale', () => {
    expect(filtreRetient(bugsGraves, { typeRetenu: 'bug', gravite: 'majeure' })).toBe(true);
    expect(filtreRetient(bugsGraves, { typeRetenu: 'bug', gravite: 'bloquante' })).toBe(true);
  });

  it('ne retient pas un Retour moins grave que la Gravité minimale, ni d’un autre Type', () => {
    expect(filtreRetient(bugsGraves, { typeRetenu: 'bug', gravite: 'mineure' })).toBe(false);
    expect(filtreRetient(bugsGraves, { typeRetenu: 'avis', gravite: 'bloquante' })).toBe(false);
  });

  it('mode dégradé : un Filtre à Gravité minimale ne retient pas un Retour sans Gravité', () => {
    const sansJuge = renderVerdict(null, 'bug');
    expect(filtreRetient(bugsGraves, sansJuge)).toBe(false);
    expect(filtreRetient({ types: ['bug'], graviteMinimale: null }, sansJuge)).toBe(true);
  });

  it('sans Gravité minimale, seul le Type compte', () => {
    expect(filtreRetient(tousLesAvis, { typeRetenu: 'avis', gravite: null })).toBe(true);
    expect(filtreRetient(tousLesAvis, { typeRetenu: 'bug', gravite: 'bloquante' })).toBe(false);
  });
});
