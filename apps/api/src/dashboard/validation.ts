import { BadRequestException } from '@nestjs/common';
import type { ErreurApiCorps } from '@nudge/shared';
import type { z } from 'zod';

/** Valide un corps de requête du dashboard ; un refus rend 400 `requete_invalide` avec le détail. */
export function parseBody<S extends z.ZodType>(schema: S, corps: unknown): z.output<S> {
  const resultat = schema.safeParse(corps ?? {});
  if (resultat.success) return resultat.data;
  const erreur: ErreurApiCorps = {
    erreur: 'requete_invalide',
    details: resultat.error.issues.map((issue) => ({
      chemin: issue.path.join('.'),
      message: issue.message,
    })),
  };
  throw new BadRequestException(erreur);
}
