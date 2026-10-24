import { randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { SecretsDestination } from '@nudge/database';
import {
  DEFINITIONS_DESTINATION,
  estTypeDestination,
  type ApiErrorBody,
  type DefinitionDestination,
} from '@nudge/shared';
import { z } from 'zod';
import { parseBody } from '../../validation.js';

/**
 * Ce qui dépend du type d'une Destination (config, secrets saisis ou générés),
 * commun aux Destinations des Projets et à la Destination d'alerte de l'Instance.
 */

/** Une Destination dont le type n'est plus servi par cette Instance ne se modifie pas. */
export function definitionDe(type: string): DefinitionDestination {
  if (estTypeDestination(type)) return DEFINITIONS_DESTINATION[type];
  const refus: ApiErrorBody = { erreur: 'type_destination_inconnu' };
  throw new BadRequestException(refus);
}

/** Config et secrets selon le schéma du type ; un refus nomme `config.…` ou `secrets.…`. */
export function validerParType(
  definition: DefinitionDestination,
  valeurs: { config: unknown; secrets: unknown },
): { config: Record<string, unknown>; secrets: SecretsDestination } {
  return parseBody(
    z.strictObject({ config: definition.config, secrets: definition.secrets }),
    valeurs,
  );
}

export function genererSecrets(definition: DefinitionDestination): Record<string, string> {
  return Object.fromEntries(
    definition.secretsGeneres.map((nom) => [nom, randomBytes(32).toString('base64url')]),
  );
}

/** Secrets générés par l'Instance d'un côté, saisis par le Membre de l'autre. */
export function separerSecrets(
  definition: DefinitionDestination,
  secrets: SecretsDestination,
): { generes: Record<string, string>; saisis: Record<string, string> } {
  const generes: Record<string, string> = {};
  const saisis: Record<string, string> = {};
  for (const [nom, valeur] of Object.entries(secrets)) {
    if (definition.secretsGeneres.includes(nom)) generes[nom] = valeur;
    else saisis[nom] = valeur;
  }
  return { generes, saisis };
}
