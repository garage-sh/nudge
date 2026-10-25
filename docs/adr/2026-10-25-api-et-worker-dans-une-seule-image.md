# L'api et le worker forment un seul serveur, dont le rôle se choisit au démarrage

nudge est auto-hébergé, le plus souvent sur une seule machine et pour une seule équipe. Deux applications (api, worker) donnaient deux images à publier, deux services à déclarer et deux versions qui pouvaient diverger, alors qu'elles partagent le schéma de la base et les types. Le worker devient une bibliothèque (`packages/worker`) que le serveur (`apps/api`) démarre selon `NUDGE_ROLES` : `api,worker` par défaut, dans un seul processus, ou `api` et `worker` séparés, avec la même image `ghcr.io/garage-sh/nudge`.

## Considered Options

- **Deux applications, deux images** (avant) : la séparation est garantie, mais chaque Instance porte un service de plus et l'api et le worker peuvent tourner à des versions différentes.
- **Deux applications, une image** : une seule version, mais toujours deux processus à déclarer, même pour une petite Instance.
- **Fusion complète dans un seul module Nest** : le plus simple, mais on perd la possibilité de répliquer le worker sans l'api, et un pic de Triage ralentirait toujours la collecte.

## Consequences

Par défaut, l'ingestion et le Triage partagent la même boucle d'événements : un pic de Triage peut ralentir la collecte, et une erreur fatale du worker arrête aussi l'api. Une Instance chargée sépare les rôles (`docker-compose.worker.yml`). L'api et le worker restent deux contextes Nest distincts, sans fournisseur partagé hors du stockage des Captures. Le processus gère lui-même l'arrêt : il ferme l'api, puis le worker, avant de sortir.
