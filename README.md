# nudge

nudge collecte les retours des utilisateurs de plusieurs applications, les trie et les envoie là où l'équipe travaille. C'est un outil open-source (AGPL-3.0) et auto-hébergé.

Chaque **Projet** intègre le **Widget**, ou appelle l'API publique depuis son serveur. Les **Retours** reçus passent par un **Triage** : un **Juge** System One (TypeSafe Jev, ou pplx-decider via OpenRouter ou auto-hébergé) détermine leur Type et leur Gravité, et repère les Retours Indésirables et les tentatives de Manipulation. Ils sont ensuite dispatchés vers les **Destinations** du Projet (webhook signé, Discord, Linear, Slack, GitHub Issues) dont le **Filtre** les retient. Les **Membres** suivent tout depuis un dashboard.

Le vocabulaire est défini dans [`CONTEXT.md`](CONTEXT.md), et les décisions d'architecture sont dans [`docs/adr/`](docs/adr/).

## Démarrer une Instance

Il faut Docker et Docker Compose v2. Une Instance est faite de cinq conteneurs : `api`, `worker`, `dashboard`, Postgres et Redis. Un sixième conteneur, `migrate`, applique les migrations puis s'arrête.

```bash
git clone https://github.com/garage-sh/nudge.git && cd nudge
cp .env.example .env
```

Dans `.env`, renseignez les deux variables requises :

```bash
NUDGE_ENCRYPTION_KEY=$(openssl rand -base64 32)   # la valeur, pas la commande
NUDGE_POSTGRES_PASSWORD=$(openssl rand -hex 24)
```

Ensuite :

```bash
docker compose up -d --build
```

Le premier lancement construit les trois images, ce qui prend quelques minutes. Quand `docker compose ps` montre `api` en état `healthy`, ouvrez <http://localhost:8080>. Le premier écran crée le premier Membre. Les suivants sont invités depuis le dashboard, par un lien d'invitation.

Vous pouvez alors :

1. créer un **Projet**. Ses clés publique et secrète ne s'affichent qu'une fois : notez-les, ou régénérez-les plus tard ;
2. déclarer ses **Origines autorisées**, c'est-à-dire les sites où le Widget est installé (`https://app.exemple.com`) ;
3. ajouter des **Destinations**, avec leur Filtre, et les tester depuis le dashboard ;
4. choisir le **Juge** dans **Paramètres**. Sans Juge, nudge tourne en mode dégradé : il ne détecte ni Gravité, ni Indésirable, ni Manipulation, et chaque Verdict est Incertain.

### Ce que sert le port publié

Seul le conteneur `dashboard` publie un port (`NUDGE_PORT`, 8080 par défaut). Il sert tout sur la même origine :

| Chemin                    | Contenu                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `/`                       | le dashboard des Membres                                    |
| `/api/…`                  | l'API du dashboard (session par cookie), relayée vers `api` |
| `/v1/retours`             | l'ingestion publique (Widget et SDK), relayée vers `api`    |
| `/widget/nudge-widget.js` | le Widget pour la balise script                             |

Comme tout est servi sur la même origine, le cookie de session reste first-party, sans CORS.

### En production : HTTPS

Placez un reverse proxy TLS (Caddy, Traefik, nginx…) devant le port publié, puis réglez :

- `NUDGE_DASHBOARD_URL=https://nudge.exemple.com` pour que les Envois et les alertes portent un lien vers le Retour ;
- `NUDGE_TRUST_PROXY=2`, c'est-à-dire votre proxy plus celui du dashboard. L'api lit l'IP du client dans `X-Forwarded-For`, ce qui sert au rate limit du Widget et à l'anti force brute de la connexion. Une valeur trop haute laisserait un client choisir son IP.

Le cookie de session est `Secure` : il faut donc HTTPS. Les navigateurs font une exception pour `http://localhost`. Pour essayer l'Instance en HTTP depuis une autre machine, `NUDGE_COOKIE_SECURE=false` lève cette protection, mais ne le faites jamais sur une Instance exposée.

### Mettre à jour, sauvegarder, monter en charge

- **Mettre à jour** : `git pull && docker compose up -d --build`. Le service `migrate` applique les nouvelles migrations avant que l'api et le worker ne redémarrent.
- **Sauvegarder** : les volumes `postgres` (la source de vérité) et `captures`, ainsi que la valeur de `NUDGE_ENCRYPTION_KEY`. Sans cette clé, les secrets stockés (clé du Juge, jetons des Destinations) sont illisibles et doivent être ressaisis. Redis ne porte que les queues, que l'état en base permet de reconstituer.
- **Monter en charge** : `docker compose up -d --scale worker=3`. Les workers se partagent les queues, et un Triage lent ne ralentit pas la collecte. Le rate limit du Widget est compté en mémoire, par réplique de l'api.

## Configuration

Toute la configuration passe par des variables d'environnement. [`.env.example`](.env.example) les décrit une à une. Une variable vide prend sa valeur par défaut. Une valeur invalide empêche l'api ou le worker de démarrer, et l'erreur nomme la variable fautive.

| Variable                                                                                                             | Rôle                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NUDGE_ENCRYPTION_KEY`                                                                                               | **Requise.** Clé d'Instance (32 octets, base64) : chiffre en AES-256-GCM les secrets en base |
| `NUDGE_POSTGRES_PASSWORD`                                                                                            | **Requise** (compose). Mot de passe de Postgres                                              |
| `NUDGE_PORT`, `NUDGE_DASHBOARD_URL`, `NUDGE_COOKIE_SECURE`, `NUDGE_TRUST_PROXY`                                      | Accès : port publié, URL publique, cookie HTTPS, proxys de confiance                         |
| `NUDGE_WIDGET_LIMITE_IP`, `NUDGE_WIDGET_LIMITE_PROJET`                                                               | Rate limit du Widget, en Retours par minute (20 par IP, 600 par Projet)                      |
| `NUDGE_JUDGE_PROVIDER`, `NUDGE_JUDGE_API_KEY`, `NUDGE_JUDGE_MODEL`, `NUDGE_JUDGE_BASE_URL`, `NUDGE_JUDGE_TIMEOUT_MS` | Juge par défaut et délai d'une requête au Juge (30 s)                                        |
| `NUDGE_TRIAGE_SEUIL_INDESIRABLE`, `NUDGE_TRIAGE_SEUIL_MANIPULATION`, `NUDGE_TRIAGE_SEUIL_CONFIANCE`                  | Seuils de la politique de Verdict (0.8, 0.7, 0.6)                                            |
| `NUDGE_SUSPENSION_SEUIL_ECHECS`, `NUDGE_SUSPENSION_REFROIDISSEMENT_MS`, `NUDGE_SUSPENSION_INTERVALLE_SONDE_MS`       | Suspension des Destinations (5 échecs, 5 min, sonde chaque minute)                           |
| `NUDGE_PURGE_INTERVALLE_MS`                                                                                          | Période de la purge de Rétention (1 h)                                                       |
| `NUDGE_CAPTURES_STOCKAGE`, `NUDGE_CAPTURES_DOSSIER`, `NUDGE_S3_*`                                                    | Stockage des Captures : disque ou S3-compatible                                              |

### Juge

Le Juge se choisit dans le dashboard (**Paramètres**), et sa clé y est stockée chiffrée. Les variables `NUDGE_JUDGE_*` ne servent que de repli tant qu'aucun Juge n'est choisi. Trois fournisseurs sont possibles :

- `typesafe` : TypeSafe System One (Jev). Il demande `NUDGE_JUDGE_API_KEY` ;
- `openrouter` : pplx-decider via l'API Decisions d'OpenRouter. Il demande `NUDGE_JUDGE_API_KEY` ;
- `auto_heberge` : tout serveur qui expose l'API Decisions (pplx-decider auto-hébergé, par exemple). Il demande `NUDGE_JUDGE_BASE_URL`, et la clé y est facultative.

Seuls le texte du Retour, son contexte non personnel et la Description du Projet partent au Juge, et uniquement comme donnée. La Capture ne lui est jamais transmise.

### Captures

Par défaut, les Captures sont écrites sur disque, dans le volume `captures` que l'api et le worker partagent. Pour un stockage objet S3-compatible (AWS S3, MinIO, Garage…), réglez `NUDGE_CAPTURES_STOCKAGE=s3` ainsi que `NUDGE_S3_ENDPOINT`, `NUDGE_S3_BUCKET`, `NUDGE_S3_ACCESS_KEY_ID` et `NUDGE_S3_SECRET_ACCESS_KEY`. `NUDGE_S3_REGION`, `NUDGE_S3_PREFIXE` et `NUDGE_S3_STYLE_CHEMIN` sont facultatives. Les Captures déjà sur disque ne sont pas migrées vers S3.

## Intégrer un Projet

### Widget : balise script

```html
<script
  src="https://nudge.exemple.com/widget/nudge-widget.js"
  data-cle="nk_pub_…"
  data-api="https://nudge.exemple.com"
></script>
```

Le Widget ajoute à la page un bouton « Laisser un retour » qui ouvre un formulaire. Il est isolé dans un Shadow DOM : son CSS et celui de la page ne se perturbent pas. Il n'est accepté que depuis les **Origines autorisées** du Projet. Il joint automatiquement l'URL de la page, le navigateur, l'OS et la taille de l'écran.

Pour transmettre l'identité de l'utilisateur connecté et des métadonnées, omettez `data-cle` et `data-api` et montez le Widget vous-même :

```html
<script src="https://nudge.exemple.com/widget/nudge-widget.js"></script>
<script>
  Nudge.monterWidget({
    cle: 'nk_pub_…',
    api: 'https://nudge.exemple.com',
    auteur: { id: 'u-42', email: 'ada@exemple.com', nom: 'Ada' },
    metadonnees: { version: '2.3.1', environnement: 'production' },
  });
</script>
```

Une identité venue du navigateur est enregistrée comme **déclarée**, jamais comme attestée : n'importe qui peut la falsifier. Pour une identité digne de confiance, envoyez le Retour depuis votre serveur avec le SDK.

**Captures.** L'Auteur peut cocher « Joindre une capture de la page ». Il voit alors un aperçu, sur lequel il peut flouter des zones avant l'envoi, et rien n'est capturé sans son accord. Marquez les éléments sensibles avec `data-nudge-mask` : ils sont toujours masqués, dans le navigateur, avant que l'image ne quitte la page.

```html
<div data-nudge-mask>IBAN : FR76 …</div>
```

### Widget : composant React

`@nudge/widget` (dans `packages/widget`) fournit aussi le web component en ESM et un wrapper React. Le package n'est pas encore publié sur npm.

```tsx
import { NudgeWidget } from '@nudge/widget/react';

<NudgeWidget cle="nk_pub_…" api="https://nudge.exemple.com" auteur={{ id: user.id }} />;
```

### SDK JS : depuis un serveur

`@nudge/sdk` (dans `packages/sdk`, pas encore publié sur npm) poste des Retours avec la **clé secrète** du Projet. L'Auteur transmis est alors **attesté**. La Source du Retour est `api`. La clé secrète ne doit jamais quitter le serveur.

```ts
import { creerClient, ErreurNudge } from '@nudge/sdk';

const nudge = creerClient({
  url: 'https://nudge.exemple.com',
  cleSecrete: process.env.NUDGE_CLE_SECRETE!, // nk_sec_…
});

try {
  const { id } = await nudge.envoyerRetour({
    texte: 'Impossible de télécharger ma facture',
    type: 'bug', // facultatif : bug | suggestion | avis | question
    auteur: { id: 'u-42', email: 'ada@exemple.com' },
    contexte: { url: 'https://app.exemple.com/factures', metadonnees: { plan: 'pro' } },
  });
} catch (erreur) {
  if (erreur instanceof ErreurNudge) console.error(erreur.statut, erreur.code, erreur.details);
}
```

Le SDK ne retente pas un envoi de lui-même. Passez `{ signal }` en second argument pour borner l'appel dans le temps.

### API HTTP

Le Widget et le SDK appellent tous deux `POST /v1/retours`, avec l'en-tête `Authorization: Bearer <clé>`. La clé publique est celle du Widget et exige l'en-tête `Origin` ; la clé secrète est celle du serveur.

| Champ      | Contenu                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `texte`    | requis, 5 000 caractères au plus                                                                |
| `type`     | facultatif : `bug`, `suggestion`, `avis` ou `question`                                          |
| `auteur`   | facultatif : `id`, `email`, `nom`                                                               |
| `contexte` | facultatif : `url`, `userAgent`, `viewport {largeur, hauteur}`, `metadonnees` (50 clés au plus) |
| `capture`  | facultatif : `{ contentType: 'image/png' \| 'image/jpeg', data: <base64> }`, 2 Mio au plus      |

L'API répond `202 { id, etat: 'recu' }`. En cas de refus, elle renvoie `{ erreur, details? }` avec l'un de ces codes :

- `400 retour_invalide` : le corps est mal formé ;
- `401 cle_manquante` ou `cle_invalide` : la clé est absente ou refusée ;
- `403 origine_refusee` : l'origine n'est pas autorisée pour ce Projet ;
- `429 trop_de_retours` : le rate limit est atteint. La réponse porte `Retry-After`.

## Développer

Il faut Node 26 (`.nvmrc`) et Docker. Yarn 4 est fourni par le dépôt (`.yarn/releases`).

```bash
yarn install
yarn dev:infra             # Postgres et Redis (docker-compose.dev.yml)
export DATABASE_URL=postgres://nudge:nudge@localhost:5432/nudge REDIS_URL=redis://localhost:6379 \
  NUDGE_ENCRYPTION_KEY=$(openssl rand -base64 32) NUDGE_COOKIE_SECURE=false \
  NUDGE_CAPTURES_DOSSIER=/tmp/nudge/captures
yarn db:migrate
yarn build
yarn workspace @nudge/api dev        # api sur :3000
yarn workspace @nudge/worker dev
yarn workspace @nudge/dashboard dev  # dashboard sur :5173, relaie /api vers :3000
```

Pour vérifier une modification :

- `yarn check-types` vérifie les types ;
- `yarn test` lance les tests (les tests du pipeline démarrent Postgres et Redis avec testcontainers) ;
- `yarn workspace @nudge/widget test:e2e` lance les tests navigateur du Widget (Playwright) ;
- `yarn lint` lance le lint.

## Licence

[AGPL-3.0](LICENSE). Si vous modifiez nudge et l'offrez comme service, vous devez publier vos modifications.
