import { BadRequestException } from '@nestjs/common';
import type { ApiErrorBody } from '@nudge/shared';
import type { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un identifiant de ligne bien formé : un autre ne désigne rien (404), sans requête en base. */
export const isUuid = (valeur: string): boolean => UUID.test(valeur);

/**
 * Valide un corps de requête ; un refus rend 400 avec un code stable
 * (`requete_invalide` par défaut) et le détail des champs refusés.
 */
export function parseBody<S extends z.ZodType>(
  schema: S,
  corps: unknown,
  erreur = 'requete_invalide',
): z.output<S> {
  const resultat = schema.safeParse(corps ?? {});
  if (resultat.success) return resultat.data;
  const refus: ApiErrorBody = {
    erreur,
    details: resultat.error.issues.map((issue) => ({
      chemin: issue.path.join('.'),
      message: issue.message,
    })),
  };
  throw new BadRequestException(refus);
}
