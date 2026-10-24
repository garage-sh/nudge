import { describe, expect, it } from 'vitest';
import { buildTriageState, renderVerdict, type TriageAnswers } from './triage.js';

/** Réponses du Juge : un bug majeur, avec la confiance donnée pour le Type et la Gravité. */
function reponses(confiance: { type: number; gravite: number }): TriageAnswers {
  return {
    type: {
      kind: 'choice',
      choice: 'bug',
      distribution: { bug: 0.7, suggestion: 0.1, avis: 0.1, question: 0.1 },
      confidence: confiance.type,
    },
    indesirable: { kind: 'noul', probability: 0.05 },
    manipulation: { kind: 'noul', probability: 0.05 },
    gravite: {
      kind: 'score',
      level: 'majeure',
      value: 0.66,
      distribution: { cosmetique: 0.1, mineure: 0.2, majeure: 0.4, bloquante: 0.3 },
      confidence: confiance.gravite,
    },
  };
}

describe('Verdict Incertain', () => {
  it('un Type incertain cède au Type déclaré par l’Auteur', () => {
    const verdict = renderVerdict(reponses({ type: 0.3, gravite: 0.9 }), 'question');

    expect(verdict).toMatchObject({ typeRetenu: 'question', gravite: 'majeure', incertain: true });
  });

  it('une Gravité incertaine marque le Verdict sans écraser un Type sûr', () => {
    const verdict = renderVerdict(reponses({ type: 0.9, gravite: 0.3 }), 'question');

    expect(verdict).toMatchObject({ typeRetenu: 'bug', gravite: 'majeure', incertain: true });
  });
});

describe('State envoyé au Juge', () => {
  it('ne transmet de l’URL de la page que l’origine et le chemin', () => {
    const state = buildTriageState({
      texte: 'Le virement échoue',
      typeDeclare: null,
      contexte: {
        url: 'https://alice:secret@banque.exemple/virements/nouveau?iban=FR76123&jeton=abc#etape-2',
      },
      descriptionProjet: null,
    });

    expect(state).toEqual({
      texte: 'Le virement échoue',
      url: 'https://banque.exemple/virements/nouveau',
    });
  });
});
