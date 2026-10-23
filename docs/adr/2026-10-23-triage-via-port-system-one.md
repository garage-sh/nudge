# Le Triage passe par un port System One, pas par Jev directement

nudge est open-source et auto-hébergé : il ne doit dépendre d'aucun fournisseur de modèle en particulier. Le Triage formule ses décisions comme des questions System One typées (Noul, Choice, Score) posées sur un état, et les envoie à un port. Chaque fournisseur compatible System One — Jev via l'API TypeSafe, pplx-decider via l'API Decisions d'OpenRouter, pplx-decider auto-hébergé — est un adaptateur de ce port, choisi par configuration de l'instance.

## Considered Options

- **Jev en dur** : plus simple, mais impossible de faire tourner nudge sans compte TypeSafe.
- **LLM génératif (chat completions)** : universel, mais il faudrait parser du texte libre et on perdrait les probabilités calibrées dont dépend le routage.

## Consequences

Les questions du Triage ne s'appuient que sur ce qui est commun aux fournisseurs System One (Noul, Choice, Score). Une fonctionnalité propre à un seul fournisseur (images, Box) ne peut pas porter une décision du Triage.
