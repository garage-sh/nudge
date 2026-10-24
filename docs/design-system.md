# Design system du dashboard

Le dashboard (`apps/dashboard`) est un outil de tri pour des devs et des PM, surtout sur bureau. La liste est dense comme chez Linear et la donnée nette comme chez Stripe. Un seul élément est mémorable : la jauge de Gravité.

Les tokens et les classes sont dans `apps/dashboard/src/styles.css`, les primitives React dans `src/layout/ui.tsx` (génériques) et `src/screens/retour-badges.tsx` (valeurs du domaine).

## Principes

1. **L'urgence se voit avant le texte.** Un Retour porte toujours sa jauge de Gravité, à la même place : liste, détail, filtres, seuil d'une Destination.
2. **Dense et calme.** Texte courant en 14 px, contrôles de 32 px, une seule surface par liste avec des séparateurs fins. Une bordure délimite un objet entier, jamais un paragraphe.
3. **La couleur dit un état, jamais une décoration.** L'accent sert à l'action principale et à la sélection. Les autres couleurs sont sémantiques (voir les tons).
4. **Les mots du domaine.** Le vocabulaire de `CONTEXT.md`, avec ses majuscules (Retour, Verdict, Destination…). Pas de jargon de système.

## Tokens

### Couleur

| Token                           | Clair                 | Rôle                                              |
| ------------------------------- | --------------------- | ------------------------------------------------- |
| `--toile`                       | `#f3f5f4`             | Fond de l'app, barre latérale                     |
| `--surface`                     | `#ffffff`             | Listes, panneaux, champs                          |
| `--surface-2`                   | `#f8faf9`             | Survol, code, pastille neutre                     |
| `--texte`                       | `#16201c`             | Texte principal (16,7:1)                          |
| `--discret`                     | `#5b6762`             | Métadonnées, aides (5,9:1)                        |
| `--bordure` / `--bordure-forte` | `#dce2df` / `#c4ccc8` | Séparateurs / contours des contrôles              |
| `--accent`                      | `#176a52`             | Action principale, sélection, liens (6,5:1)       |
| `--revue`                       | `#5a48c8`             | Attend une décision humaine : En revue, Incertain |
| `--succes`                      | `#1c7a4a`             | Dispatché, Livré, Active                          |
| `--danger`                      | `#b42318`             | Échec, erreur, suppression                        |
| `--retenu`                      | `#9a5b00`             | Suspendue, Retenu, avertissement                  |
| `--gravite-1…4`                 | `#87938e` → `#b4161b` | Jauge : Cosmétique, Mineure, Majeure, Bloquante   |

Chaque couleur sémantique a sa variante `-doux` pour les fonds. Le mode sombre (`prefers-color-scheme: dark`) redéfinit chaque token avec ses propres valeurs ; aucun composant n'utilise de couleur littérale.

### Typographie

- **Instrument Sans** (variable, `@fontsource-variable/instrument-sans`) pour tout.
- **JetBrains Mono** (`@fontsource/jetbrains-mono`) seulement pour des valeurs techniques réelles : clés, URL de webhook, identifiants. Jamais pour un libellé.
- Les polices sont embarquées dans le build : l'Instance auto-hébergée ne contacte aucun service tiers.
- Échelle : `--t-xs` 12, `--t-s` 13 (métadonnées, libellés de champ), `--t-m` 14 (texte courant), `--t-l` 16 (titres de panneau, texte d'un Retour), `--t-xl` 20 (titre d'écran), `--t-2xl` 28 (écrans publics). Graisses : 400, 500 (libellés, boutons), 600 (titres).
- Chiffres alignés (`tabular-nums`) partout où des nombres se comparent : dates, compteurs, tentatives.

### Forme et mouvement

- Rayons : `--r-controle` 6 px (boutons, champs, cases), `--r-panneau` 10 px (panneaux, listes, dialogues), pilule pour les pastilles.
- Pas d'ombre au repos. `--ombre-flottant` est réservée à ce qui flotte : tiroir mobile, menus, dialogues.
- `--duree` 140 ms, ease-out, seulement en réponse à une action. Tout est coupé sous `prefers-reduced-motion`.

## Gabarit

```
┌────────────────────┬────────────────────────────────────────────┐
│ ▂▄▆█ nudge         │ ← retour                                   │
│ Boîte de réception │ Titre de l'écran              [actions]    │
│                    │ description                                │
│ Projets            ├────────────────────────────────────────────┤
│   Boutique         │ contenu (max 1040 px)                      │
│   Comptoir         │                                            │
│ [alertes]          │                                            │
│ Membres            │                                            │
│ Paramètres         │                                            │
│ compte             │                                            │
└────────────────────┴────────────────────────────────────────────┘
```

- `Layout` : barre latérale de 232 px, sticky. Sous 860 px, elle devient un tiroir ouvert par « Menu » (fermé par Échap, le voile ou une navigation).
- Les entrées fixes sont dans `layout/navigation.ts` ; les Projets sont lus depuis l'API.
- Les alertes (`Alertes`) vivent dans la barre latérale : En revue en violet, Destination suspendue en ambre.
- `PublicPage` : écrans sans session (setup, connexion, invitation), colonne de 400 px centrée.

## Primitives

| Primitive                                                                          | Où                  | Quand                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                                                       | `ui.tsx`            | En tête de chaque écran connecté : le seul `h1`, un lien de retour facultatif, une description, les actions de l'écran.                               |
| `EmptyState`                                                                       | `ui.tsx`            | Une liste ou une section sans contenu : dire pourquoi, proposer l'action qui la remplit.                                                              |
| `Loading`                                                                          | `ui.tsx`            | Pendant une requête : silhouettes de lignes, annoncées « Chargement… ».                                                                               |
| `ErrorMessage`                                                                     | `ui.tsx`            | Erreur d'API, en clair et avec l'action à faire (codes dans `MESSAGES`). `onRetry` ajoute « Réessayer » sur une lecture qui a échoué.                 |
| `Field`                                                                            | `ui.tsx`            | Un champ texte avec libellé et aide.                                                                                                                  |
| `CopyableValue`                                                                    | `ui.tsx`            | Clé ou lien à copier.                                                                                                                                 |
| `ConfirmAction`                                                                    | `ui.tsx`            | Action irréversible derrière un bouton : la confirmation s'ouvre sur place, avec le focus sur Annuler. Échap annule et rend le focus au bouton.       |
| `Confirmation`                                                                     | `ui.tsx`            | La même question, déclenchée autrement, par exemple un enregistrement qui efface des données (rétention plus courte).                                 |
| `StatutEnregistrement`                                                             | `ui.tsx`            | « Enregistré. » après un enregistrement, annoncé aux lecteurs d'écran. Le formulaire l'efface dès qu'il change (`onChange={() => mutation.reset()}`). |
| `useFocusAuRetour`                                                                 | `ui.tsx`            | Rend le focus au bouton qui a ouvert un formulaire (Corriger, Modifier) quand celui-ci se referme.                                                    |
| `LienExterne`                                                                      | `ui.tsx`            | Toute URL venue de l'extérieur (lien seulement en http(s)).                                                                                           |
| `Pastille`                                                                         | `ui.tsx`            | Un État ou un Statut, colorée par un ton : `neutre`, `succes`, `revue`, `danger`, `retenu`, `eteint`.                                                 |
| `JaugeGravite`                                                                     | `retour-badges.tsx` | La Gravité d'un Retour ; `grande` dans le détail. Pointillés sans Gravité.                                                                            |
| `PastilleEtat`, `PastilleStatutEnvoi`, `PastilleEtatDestination`, `BadgeIncertain` | `retour-badges.tsx` | Les valeurs du domaine, avec leur ton fixé une fois pour toutes.                                                                                      |

### Classes

- `.encadre` : un panneau, pour un objet entier (un Verdict, une Destination, une section de réglages).
- `.liste` : une surface avec des séparateurs, pour une collection. Pas de carte par élément.
- `.formulaire`, `.champ`, `fieldset.champ` + `.case` (cases à cocher en pastilles), `.actions` (rangée de boutons), `.aide`, `.discret`.
- `.alerte` (erreur), `.avertissement` (attention, ambre), `.vide` (état vide), `.meta` (métadonnées en ligne), `.proprietes` (paires libellé / valeur).

### Boutons

- `button` sans classe : **plein**, l'action principale. Au plus un par écran ou par panneau.
- `.secondaire` : contour, pour toutes les autres actions.
- `.fantome` : sans contour, pour Annuler et les actions de faible poids.
- `.danger` : plein rouge, seulement pour confirmer une suppression (dans `ConfirmAction`).

## Motifs d'écran

Chaque écran connecté commence par `PageHeader`. Les motifs ci-dessous sont les formes déjà résolues : un nouvel écran de la même forme les reprend.

- **Liste à trier** (Boîte de réception, `screens/Retours.tsx`) :
  - `.vues` : raccourcis vers un filtre, en liens avec `aria-current` ;
  - `.filtres` / `.filtre` : pastilles qui portent un `select` natif et passent en trait plein quand elles sont actives ;
  - `.liste-retours` : une surface, des groupes par jour (`.groupe-jour`) et des lignes `.ligne-retour` en grille à colonnes fixes ;
  - toute la ligne ouvre l'élément : un lien étiré par `::after`.

  Un résultat vide propose « Effacer les filtres ».

- **Fiche d'un élément** (détail d'un Retour, `screens/Retour.tsx`) :
  - `.fil` : retour à la liste d'origine, avec ses filtres, et Précédent / Suivant d'après l'état de navigation `ListeState` ;
  - `.retour-grille` : contenu et décision à gauche, propriétés à droite (`.retour-cote`, sections à plat séparées par des filets). Une seule colonne sous 1100 px ;
  - une décision qui attend un Membre se met en bandeau (`.bandeau-revue`), au-dessus de tout le reste.
- **Objet à onglets** (Projet, `EnteteProjet` dans `screens/Projet.tsx`) :
  - un en-tête commun et des `.onglets` en `NavLink`, une route par onglet ;
  - l'action principale de l'onglet va dans l'en-tête.
- **Collection configurable** (Destinations, Projets) :
  - une ligne par objet (`.destination`) ;
  - l'ajout est l'action de l'en-tête et ouvre le formulaire en haut de la liste. Il est ouvert d'office quand la collection est vide, et l'état vide (`EmptyState`) dit quoi y mettre ;
  - un objet en difficulté dit pourquoi et quoi faire (`.probleme`).
- **Réglages** (Paramètres, Réglages d'un Projet) : une colonne `.reglages` de 760 px au plus, un panneau `.encadre` par sujet, et un bouton plein par panneau.

## Règles de rédaction

- Un bouton dit ce qu'il fait, avec le nom du domaine : « Ajouter la Destination », « Réhabiliter », pas « Valider le formulaire ».
- Une action garde le même nom dans tout le parcours (bouton, confirmation, message de succès).
- Une erreur dit ce qui s'est passé et quoi faire, sans s'excuser.
- Dans les listes, les dates sont relatives (`formatDateRelative`), et la date exacte s'affiche en `title`. Les groupes par jour utilisent `formatJour`.
- Un état vide invite à agir.
- Pas de majuscules pour les libellés, pas de point médian pour joindre des métadonnées : chaque métadonnée est un élément à part.
