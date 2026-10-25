# Contribuer à nudge

Merci de votre intérêt. nudge est maintenu sur le temps libre de son auteur : une contribution bien préparée a plus de chances d'être relue vite.

## Avant d'écrire du code

- **Un bug** : ouvrez une issue avec le modèle « Bug », sauf s'il s'agit d'une faille de sécurité (voir [`SECURITY.md`](SECURITY.md)).
- **Une fonctionnalité ou un changement de comportement** : ouvrez d'abord une issue pour en discuter. Une PR qui arrive sans discussion préalable risque d'être refusée, même si elle est bonne, quand elle ne va pas dans la direction du projet.
- **Une correction de documentation ou de typo** : une PR directe suffit.

## Préparer son poste

La procédure est dans la section [Développer](README.md#développer) du README : Node 26, Docker, `yarn install`, `yarn dev`.

## Conventions

- **Le vocabulaire du domaine** est défini dans [`CONTEXT.md`](CONTEXT.md) : Retour, Verdict, Destination, Envoi… Le code, les tests, l'interface et les messages de commit l'emploient, en français.
- **Les décisions d'architecture** sont dans [`docs/adr/`](docs/adr/). Une PR qui revient sur l'une d'elles le dit et propose un nouvel ADR.
- **L'interface du dashboard** suit [`docs/design-system.md`](docs/design-system.md).
- **Les commits** suivent les [Conventional Commits](https://www.conventionalcommits.org/fr/), en français : `feat(dashboard): …`, `fix(api): …`, `docs: …`. Les notes de version en sont tirées.
- **Les tests** accompagnent chaque changement de comportement. Les tests du pipeline (`tests/pipeline`) démarrent Postgres et Redis avec testcontainers : Docker doit tourner.

## Ouvrir une Pull Request

Avant de pousser :

```bash
yarn prettier --check .
yarn lint
yarn check-types
yarn test
```

La CI lance les mêmes vérifications, construit les images et cherche des secrets dans l'historique. Décrivez le problème, la solution et la façon de vérifier, puis liez l'issue (`Closes #12`).

## Licence des contributions

nudge est publié sous [AGPL-3.0](LICENSE). En ouvrant une Pull Request, vous acceptez que votre contribution soit publiée sous cette même licence.
