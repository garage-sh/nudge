import type { DEFINITIONS_DESTINATION, TypeDestination } from '@nudge/shared';
import type { ReactNode } from 'react';

/** Ce que le formulaire commun passe aux champs propres à un type. */
export interface ChampsTypeProps {
  /** Préfixe des `id` des champs : plusieurs formulaires coexistent sur l'écran. */
  readonly idPrefixe: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly setConfig: (config: Record<string, unknown>) => void;
  /** Secrets saisis dans ce formulaire ; une clé absente garde le secret enregistré. */
  readonly secrets: Readonly<Record<string, string>>;
  readonly setSecrets: (secrets: Record<string, string>) => void;
  /** Noms des secrets déjà enregistrés (chiffrés, jamais rendus par l'api). */
  readonly secretsEnregistres: readonly string[];
}

/**
 * Le versant dashboard d'un type de Destination. Chaque type (`webhook.tsx`…) en
 * exporte un, enregistré dans `FORMULAIRES_DESTINATION` (`index.ts`).
 */
export interface FormulaireTypeDestination<T extends TypeDestination = TypeDestination> {
  readonly libelle: string;
  /** Configuration d'une Destination neuve de ce type. */
  readonly configInitiale: Readonly<Record<string, unknown>>;
  /** Champs de config et de secrets propres au type. */
  readonly Champs: (props: ChampsTypeProps) => ReactNode;
  /** Résumé de la config dans la liste (une URL, un salon…), affiché comme du texte. */
  readonly resume: (config: Readonly<Record<string, unknown>>) => string;
  /** Libellé et usage de chaque secret généré par l'Instance, montré une fois. */
  readonly secretsGeneres: Readonly<
    Record<
      (typeof DEFINITIONS_DESTINATION)[T]['secretsGeneres'][number],
      { libelle: string; aide: string }
    >
  >;
}
