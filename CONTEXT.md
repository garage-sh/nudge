# nudge

Outil open-source et auto-hébergé qui collecte les retours des utilisateurs de plusieurs applications, les trie, puis les dispatche vers les outils de l'équipe.

## Language

### Collecte

**Projet**:
Une application dont nudge collecte les retours. Unité de configuration : chaque Projet a ses propres règles de triage et de dispatch.
_Avoid_: App, client, tenant

**Description du Projet**:
Un court texte facultatif qui dit au Juge ce qu'est le Projet et ce qui y est critique, pour qu'il évalue mieux la Gravité.
_Avoid_: Prompt, contexte

**Retour**:
Un message laissé par un utilisateur d'un Projet (bug, suggestion, avis, question). C'est l'objet central de nudge, conservé dans la durée.
_Avoid_: Feedback, ticket, message, report

**Source**:
Le point d'entrée par lequel un Retour est arrivé : Widget ou API (plus tard, l'extension de QA).
_Avoid_: Canal, origine, provenance

**Type de retour**:
La nature d'un Retour : Bug, Suggestion, Avis ou Question. L'utilisateur peut la déclarer (facultatif), mais c'est le Triage qui fixe le type retenu.
_Avoid_: Catégorie, kind

**Avis**:
Un Type de retour : une opinion de l'utilisateur sur le Projet (compliment, critique), sans demande d'action précise.
_Avoid_: Feedback, commentaire

**Question**:
Un Type de retour : l'utilisateur demande de l'aide ou une explication.
_Avoid_: Support, demande

**Auteur**:
La personne qui a laissé un Retour. Anonyme par défaut ; identifiée seulement si l'application hôte ou l'utilisateur le fournit.
_Avoid_: User, reporter, client

**Widget**:
Le formulaire embarquable que nudge fournit aux Projets web pour recueillir des Retours.
_Avoid_: SDK, snippet, plugin

### Traitement

**Triage**:
L'étape qui évalue un Retour reçu et rend un verdict sur la manière de le traiter.
_Avoid_: Classification, analyse

**Verdict**:
Le résultat du Triage pour un Retour : son Type retenu, s'il est indésirable, et sa Gravité.
_Avoid_: Résultat, label, tag

**Gravité**:
Le degré d'urgence d'un Retour, du cosmétique au bloquant.
_Avoid_: Priorité, sévérité, criticité

**Juge**:
Le modèle de décision System One qui répond aux questions du Triage (Jev, pplx-decider…), choisi par l'instance.
_Avoid_: IA, LLM, modèle, provider

**Indésirable**:
Un Verdict : le Retour est du spam, vide ou abusif. Il est conservé mais jamais dispatché, sauf réhabilitation par un Membre.
_Avoid_: Spam, rejeté, poubelle

**Manipulation**:
Un Verdict : le Retour tente d'influencer le Triage. Il est mis En revue au lieu d'être dispatché.
_Avoid_: Injection, attaque

**Incertain**:
Marqueur d'un Verdict sur lequel le Juge a hésité. Il ne bloque rien ; il signale qu'un Membre devrait vérifier.
_Avoid_: À revoir, douteux

**En revue**:
État d'un Retour suspect de Manipulation, retenu jusqu'à ce qu'un Membre le valide (il est alors dispatché) ou le rejette (il devient Écarté).
_Avoid_: Quarantaine, en attente

**Écarté**:
État d'un Retour qui ne sera pas dispatché (Indésirable, ou rejeté après revue).
_Avoid_: Supprimé, archivé

### Dispatch

**Dispatch**:
L'envoi d'un Retour trié vers les Destinations de son Projet dont le Filtre le retient.
_Avoid_: Notification, forward, export

**Destination**:
Un endroit externe configuré sur un Projet, vers lequel des Retours sont envoyés (un salon Discord, une équipe Linear, un webhook…).
_Avoid_: Canal, intégration, connecteur, sink

**Filtre**:
La condition portée par une Destination (Types retenus, Gravité minimale) qui décide si un Retour lui est envoyé.
_Avoid_: Règle, route, abonnement

**Envoi**:
Une tentative de livraison d'un Retour à une Destination, avec son statut et le lien vers l'objet créé chez elle. Un Retour a un Envoi par Destination retenue.
_Avoid_: Delivery, job, dispatch

**Suspendue**:
État d'une Destination dont les Envois échouent de façon répétée ; ses Envois sont retenus jusqu'à ce qu'elle redevienne joignable.
_Avoid_: Désactivée, en panne, circuit ouvert

### Instance

**Instance**:
Un déploiement auto-hébergé de nudge, avec ses Projets, ses Membres et son Juge.
_Avoid_: Workspace, organisation, tenant

**Destination d'alerte**:
Une Destination désignée au niveau de l'Instance qui reçoit les alertes destinées aux Membres (Retour En revue, Destination Suspendue), et non des Retours.
_Avoid_: Canal ops, notifications

**Membre**:
Une personne qui se connecte au dashboard d'une Instance. Tous les Membres voient tous les Projets.
_Avoid_: Admin, user, utilisateur

**Capture**:
Une capture d'écran jointe à un Retour à l'initiative de l'Auteur, après masquage éventuel. Elle n'est jamais transmise au Juge.
_Avoid_: Screenshot, pièce jointe
