import type { Messages } from './en.js';

/** Plural for French: 0 and 1 take the singular. */
const s = (count: number) => (count > 1 ? 's' : '');

/** The dashboard's copy in French. The only file of the dashboard written in French. */
export const fr: Messages = {
  localeName: 'Français',

  labels: {
    feedbackType: {
      bug: 'Bug',
      suggestion: 'Suggestion',
      opinion: 'Avis',
      question: 'Question',
    },
    severity: {
      cosmetic: 'Cosmétique',
      minor: 'Mineure',
      major: 'Majeure',
      blocking: 'Bloquante',
    },
    feedbackState: {
      received: 'Reçu',
      triaged: 'Trié',
      dispatched: 'Dispatché',
      discarded: 'Écarté',
      in_review: 'En revue',
    },
    source: {
      widget: 'Widget',
      api: 'API',
      extension: 'Extension',
    },
    authorTrust: {
      declared: 'Déclarée',
      attested: 'Attestée',
    },
    deliveryStatus: {
      pending: 'En attente',
      delivered: 'Livré',
      failed: 'Échec',
      held: 'Retenu',
    },
    destinationState: {
      active: 'Active',
      suspended: 'Suspendue',
    },
    level: {
      info: 'Info',
      warning: 'Avertissement',
      error: 'Erreur',
      critical: 'Critique',
    },
    levelOrigin: {
      declared: 'Déclaré par l’émetteur',
      judge: 'Évalué par le Juge',
      default: 'Niveau par défaut du Projet',
    },
    incidentState: {
      open: 'Ouvert',
      closed: 'Clos',
    },
    closeCause: {
      resolved: 'Résolu par son émetteur',
      member: 'Clos par un Membre',
      quiet_period: 'Période de calme écoulée',
    },
    failureClass: {
      transient: 'indisponibilité passagère',
      auth: 'identifiants refusés',
      permanent: 'refusé par la Destination',
    },
    judgeProvider: {
      typesafe: 'TypeSafe',
      openrouter: 'OpenRouter',
      self_hosted: 'Votre serveur (API Decisions)',
    },
    judgeProviderDescription: {
      typesafe: 'Les modèles de décision de TypeSafe, avec votre clé API TypeSafe.',
      openrouter:
        'Les modèles de décision proposés par OpenRouter, par son API Decisions, avec votre clé API OpenRouter.',
      self_hosted:
        'Le modèle de décision de votre choix, servi par votre propre serveur : tout serveur qui expose l’API Decisions convient. La clé est facultative.',
    },
  },

  apiErrors: {
    incident_not_found: 'Cet Incident n’existe pas.',
    invalid_credentials: 'Email ou mot de passe incorrect.',
    setup_completed: 'Le premier compte existe déjà : connectez-vous.',
    email_already_used: 'Un Membre utilise déjà cet email.',
    invalid_invitation: 'Ce lien d’invitation est invalide, expiré ou déjà utilisé.',
    project_not_found: 'Ce Projet n’existe pas.',
    feedback_not_found: 'Ce Retour n’existe pas.',
    transition_refused: 'Ce Retour a changé entre-temps : voici son état actuel.',
    storage_unavailable:
      'La Capture n’a pas pu être effacée du stockage : le Retour est gardé. Réessayez plus tard.',
    feedback_not_triaged: 'Ce Retour n’est pas encore trié : il n’a pas de Verdict à corriger.',
    delivery_not_found: 'Cet Envoi n’existe plus.',
    delivery_not_replayable:
      'Cet Envoi est en cours ou retenu par sa Destination Suspendue : il ne se rejoue pas maintenant.',
    feedback_not_redispatchable:
      'Ce Retour ne peut pas être redispatché : seul un Retour Trié ou Dispatché se redispatche.',
    incident_not_redispatchable:
      'Cet Incident ne peut pas être redispatché : seul un Incident Ouvert se redispatche.',
    destination_not_found: 'Cette Destination n’existe plus.',
    unknown_destination_type: 'Ce type de Destination n’est pas pris en charge par cette Instance.',
    session_required: 'Votre session a expiré : reconnectez-vous.',
    server_busy: 'L’Instance vérifie déjà d’autres mots de passe. Réessayez dans un instant.',
    invalid_setup_token:
      'Ce jeton d’installation est incorrect : copiez-le depuis les journaux du serveur nudge, ou depuis NUDGE_SETUP_TOKEN.',
    invalid_current_password: 'Votre mot de passe actuel est incorrect.',
    member_not_found: 'Ce Membre n’existe plus.',
    cannot_remove_self:
      'Vous ne pouvez pas vous retirer vous-même : demandez-le à un autre Membre.',
    too_many_attempts: 'Trop de tentatives : patientez une minute, puis réessayez.',
    smtp_missing: 'Aucun serveur SMTP n’est enregistré : enregistrez-en un d’abord.',
  },
  unreachable: 'L’Instance est injoignable. Réessayez.',
  unexpectedError: (code) => `Erreur inattendue (${code}).`,

  validation: {
    required: 'Obligatoire.',
    email: 'Saisissez une adresse e-mail, comme nom@exemple.fr.',
    url: 'Saisissez une URL complète, commençant par https://.',
    tooShort: (min) => `Au moins ${min} caractères.`,
    tooLong: (max) => `Au plus ${max} caractères.`,
    min: (min) => `Au moins ${min}.`,
    max: (max) => `Au plus ${max}.`,
    wholeNumber: 'Saisissez un nombre entier.',
    invalid: 'Vérifiez cette valeur.',
  },

  common: {
    retry: 'Réessayer',
    saved: 'Enregistré.',
    loading: 'Chargement…',
    save: 'Enregistrer',
    cancel: 'Annuler',
    confirm: 'Confirmer',
    close: 'Fermer',
    test: 'Tester',
    edit: 'Modifier',
    delete: 'Supprimer',
    copy: 'Copier',
    copied: 'Copié',
    copiedToClipboard: 'Copié dans le presse-papier.',
    copyManually:
      'Copie automatique impossible : le texte est sélectionné, copiez-le avec ⌘C ou Ctrl+C.',
    language: 'Langue',
  },

  time: {
    justNow: 'à l’instant',
    minutesAgo: (minutes) => `il y a ${minutes} min`,
    hoursAgo: (hours) => `il y a ${hours} h`,
    yesterdayAt: (time) => `hier, ${time}`,
    today: 'Aujourd’hui',
    yesterday: 'Hier',
  },

  units: { bytes: 'o', kibibytes: 'Kio', mebibytes: 'Mio' },

  layout: {
    menu: 'Menu',
    closeMenu: 'Fermer le menu',
    mainNavigation: 'Navigation principale',
    instanceNavigation: 'Instance',
    inbox: 'Boîte de réception',
    projects: 'Projets',
    members: 'Membres',
    settings: 'Paramètres',
    signOut: 'Se déconnecter',
    inReviewTitle: 'Retours En revue',
    inReviewHidden: ', Retours En revue : ',
    thisWeekTitle: 'Retours reçus ces sept derniers jours',
    thisWeekHidden: ', Retours cette semaine : ',
  },

  alerts: {
    region: 'Alertes',
    inReview: (count) => `${count} Retour${s(count)} en revue`,
    suspended: (destination, project) => `Destination suspendue : ${destination} (${project})`,
  },

  badges: {
    uncertain: 'Incertain',
    uncertainTitle: 'Le Juge a hésité : à vérifier',
    noSeverity: 'Sans Gravité',
    severity: (label) => `Gravité ${label}`,
  },

  account: {
    email: 'Email',
    password: 'Mot de passe',
    passwordHelp: (min) => `${min} caractères au moins.`,
  },

  signIn: {
    title: 'Connexion',
    submit: 'Se connecter',
  },

  setup: {
    title: 'Créer le premier compte',
    intro: 'Cette Instance n’a encore aucun Membre. Le compte créé ici pourra inviter les autres.',
    submit: 'Créer le compte',
    token: 'Jeton d’installation',
    tokenHelp:
      'Il prouve que vous administrez cette Instance : le serveur nudge l’affiche dans ses journaux au démarrage (docker compose logs nudge), sauf si NUDGE_SETUP_TOKEN le fixe.',
  },

  invitation: {
    title: 'Invitation',
    askAgainBefore: 'Demandez un nouveau lien à un Membre, ou ',
    signInLink: 'connectez-vous',
    askAgainAfter: '.',
    joinTitle: 'Rejoindre l’Instance',
    intro: 'Vous êtes invité à rejoindre cette Instance nudge. Créez votre compte de Membre.',
    submit: 'Créer mon compte',
  },

  crash: {
    title: 'Une erreur est survenue',
    help: 'Cet écran s’est arrêté sur une erreur inattendue. Rechargez la page ; si cela se reproduit, signalez-le avec les étapes qui y ont mené.',
    reload: 'Recharger',
  },

  notFound: {
    title: 'Page introuvable',
    empty: 'Cette adresse ne mène à aucun écran.',
    back: 'Revenir à la Boîte de réception',
    help: 'Le lien est peut-être incomplet, ou l’élément a été supprimé.',
  },

  members: {
    title: 'Membres',
    description:
      'Tous les Membres voient tous les Projets. Pour inviter quelqu’un, générez un lien et transmettez-le lui : il sert une seule fois.',
    generate: 'Générer un lien d’invitation',
    invitationLink: 'Lien d’invitation',
    validUntil: (date) =>
      `Valable jusqu’au ${date}, pour un seul compte. Un nouveau lien ne révoque pas les précédents.`,
    list: 'Membres de l’Instance',
    you: ' (vous)',
    since: (date) => `Membre depuis le ${date}`,
    remove: 'Retirer',
    removeLabel: (email) => `Retirer ${email}`,
    removeQuestion: (email) => `Retirer ${email} ? Ses sessions prennent fin aussitôt.`,
    removed: (email) => `${email} n’est plus Membre.`,
  },

  ownAccount: {
    title: 'Votre compte',
    currentPassword: 'Mot de passe actuel',
    newPassword: 'Nouveau mot de passe',
    changePassword: 'Changer le mot de passe',
    passwordChanged: 'Mot de passe changé. Vos autres sessions sont déconnectées.',
    sessionsTitle: 'Sessions',
    sessionsHelp:
      'Un appareil perdu, un ordinateur partagé : déconnectez-vous partout ailleurs. Cette session reste ouverte.',
    signOutOthers: 'Se déconnecter partout ailleurs',
    signedOutOthers: (count) =>
      count === 0
        ? 'Aucune autre session n’était ouverte.'
        : `${count} autre${s(count)} session${s(count)} déconnectée${s(count)}.`,
  },

  inbox: {
    title: 'Boîte de réception',
    views: 'Vues',
    view: {
      all: 'Tous',
      in_review: 'En revue',
      received: 'Reçus',
      triaged: 'Triés',
      dispatched: 'Dispatchés',
      discarded: 'Écartés',
    },
    filters: 'Filtres',
    filter: {
      project: 'Projet',
      type: 'Type',
      severity: 'Gravité',
      source: 'Source',
      uncertain: 'Verdict',
    },
    anyProject: 'Tous',
    anyType: 'Tous',
    anySeverity: 'Toutes',
    anySource: 'Toutes',
    anyVerdict: 'Tous',
    uncertainOnly: 'Incertains seulement',
    withoutUncertain: 'Sans les Incertains',
    shown: (count, more) =>
      `${count} Retour${s(count)} affiché${s(count)}${more ? ', d’autres à charger' : ''}.`,
    noMatch: 'Aucun Retour ne correspond à ces filtres.',
    clearFilters: 'Effacer les filtres',
    emptyTitle: 'Aucun Retour pour l’instant.',
    emptyHelp:
      'Les Retours arrivent ici dès qu’un Projet en reçoit, par le Widget ou par l’API. La page d’un Projet donne ses clés.',
    showMore: 'Afficher plus',
    shortcutsNextPrevious: 'Retour suivant ou précédent,',
    shortcutsEscape: 'Échap',
    shortcutsClose: 'fermer',
    openFeedback: 'Retour ouvert',
    notTriaged: 'Non trié',
  },

  feedback: {
    heading: (text) => `Retour : ${text}`,
    text: 'Texte du Retour',
    declaredType: (type) => `Type déclaré par l’Auteur : ${type}`,
    trail: 'Fil',
    backToInbox: '← Boîte de réception',
    position: (position, total) => `${position} sur ${total}`,
    previous: 'Précédent',
    next: 'Suivant',
    properties: 'Propriétés du Retour',
    sections: {
      review: 'Revue',
      capture: 'Capture',
      deliveries: 'Envois',
      verdict: 'Verdict',
      author: 'Auteur',
      context: 'Contexte',
      deletion: 'Suppression',
    },
    review: {
      inReview:
        'Le Juge soupçonne une tentative de Manipulation du Triage : ce Retour n’a été envoyé nulle part. Validez-le pour le dispatcher, ou rejetez-le.',
      junk: 'Écarté comme Indésirable. S’il s’agit d’un vrai Retour, réhabilitez-le : il sera dispatché normalement.',
      approve: 'Valider',
      reject: 'Rejeter',
      rejectQuestion: 'Rejeté, le Retour est Écarté et ne pourra plus être réhabilité. Rejeter ?',
      reinstate: 'Réhabiliter',
    },
    deletion: {
      help: (withCapture) =>
        `Efface définitivement ce Retour${withCapture ? ' et sa Capture' : ''}, par exemple pour une demande d’effacement de l’Auteur. Ce qui a déjà été créé chez les Destinations (issues, messages) n’est pas touché.`,
      question: 'Le Retour sera effacé définitivement. Supprimer ?',
    },
    capture: {
      alt: 'Capture de la page jointe par l’Auteur',
      open: 'Ouvrir l’image',
    },
    verdict: {
      notTriaged: 'Ce Retour n’est pas encore trié.',
      resolvedType: 'Type retenu',
      severity: 'Gravité',
      notAssessed: 'Non évaluée',
      junk: 'Indésirable',
      manipulation: 'Manipulation',
      correct: 'Corriger',
      uncertainHelp:
        'Le Juge a hésité sur ce Verdict : vérifiez le Type et la Gravité, et corrigez-les si besoin.',
      degradedHelp: 'Trié sans Juge : le Type déclaré par l’Auteur est retenu, sans Gravité.',
      setUpJudge: 'Configurer un Juge',
      correctionHelp:
        'La correction ne change rien chez les Destinations déjà servies : rejouez un Envoi pour la leur propager, ou redispatchez le Retour pour l’envoyer aux Destinations qui le retiennent désormais.',
    },
    author: {
      anonymous: 'Anonyme',
      name: 'Nom',
      email: 'Email',
      id: 'Identifiant',
      trust: 'Identité',
    },
    context: {
      page: 'Page',
      browser: 'Navigateur',
      screen: 'Écran',
      none: 'Aucun contexte transmis.',
      metadata: 'Métadonnées',
    },
    deliveries: {
      none: 'Aucun Envoi.',
      attempts: (count) => `${count} tentative${s(count)}`,
      replay: 'Rejouer',
      lastError: (error) => `Dernière erreur : ${error}`,
    },
    redispatch: {
      help: 'Redispatcher envoie le Retour, selon son Verdict actuel, aux Destinations dont le Filtre le retient et qui ne l’ont pas encore reçu. Les Envois existants ne sont pas touchés.',
      action: 'Redispatcher',
      noneCreated: 'Aucune autre Destination ne retient ce Retour.',
      created: (count) => `${count} Envoi${s(count)} créé${s(count)}.`,
    },
  },

  projects: {
    title: 'Projets',
    description:
      'Chaque Projet est une application dont nudge collecte les Retours, avec ses propres clés et Destinations.',
    new: 'Nouveau Projet',
    emptyTitle: 'Aucun Projet pour l’instant.',
    emptyHelp:
      'Créez le premier ci-dessous : vous obtiendrez ses clés pour brancher le Widget ou l’API.',
    list: 'Projets de l’Instance',
    thisWeek: (count) => `${count} Retour${s(count)} cette semaine`,
    inReview: (count) => `${count} En revue`,
    noDestination: 'Aucune Destination',
    destinations: (count) => `${count} Destination${s(count)}`,
    destinationsSuspended: (count, suspended) =>
      `${count} Destination${s(count)}, dont ${suspended} Suspendue${s(suspended)}`,
    name: 'Nom du Projet',
    create: 'Créer le Projet',
  },

  project: {
    fallbackTitle: 'Projet',
    sections: 'Sections du Projet',
    destinationsTab: 'Destinations',
    incidentsTab: 'Incidents',
    settingsTab: 'Réglages',
    keys: 'Clés',
    publicKey: 'Clé publique',
    publicKeyHelp: 'Pour le Widget ; acceptée seulement depuis les origines autorisées.',
    regeneratePublicKey: 'Régénérer la clé publique',
    regeneratePublicKeyQuestion: 'L’ancienne clé publique cessera de fonctionner. Régénérer ?',
    secretKey: 'Clé secrète',
    secretKeyHelp: 'Pour envoyer des Retours depuis un serveur. Ne la publiez jamais.',
    copySecretKeyNow: 'Copiez la clé secrète maintenant : elle ne sera plus jamais affichée.',
    secretKeyShownOnce: 'Affichée une seule fois, à sa création. Perdue ? Régénérez-la.',
    regenerateSecretKey: 'Régénérer la clé secrète',
    regenerateSecretKeyQuestion:
      'L’ancienne clé secrète cessera immédiatement de fonctionner. Régénérer ?',
    details: 'Informations',
    saveDetails: 'Enregistrer les informations',
    description: 'Description du Projet',
    descriptionHelp:
      'Facultative. Dites au Juge ce qu’est le Projet et ce qui y est critique, pour qu’il évalue mieux la Gravité.',
    allowedOrigins: 'Origines autorisées',
    originsLabel: 'Une origine par ligne',
    originsHelp:
      'Le Widget n’est accepté que depuis ces origines (schéma://hôte[:port], sans chemin).',
    saveOrigins: 'Enregistrer les origines',
    incidents: {
      title: 'Incidents',
      help: 'Votre application signale un Incident quand quelque chose se passe mal de son côté, depuis son serveur uniquement, avec la clé secrète.',
      defaultLevel: 'Niveau par défaut',
      defaultLevelHelp:
        'Le Niveau d’un Incident dont l’émetteur n’en déclare aucun, quand le Juge n’en donne aucun à temps.',
      quietPeriod: 'Période de calme (minutes)',
      quietPeriodHelp:
        'Un Incident sans nouvelle Occurrence pendant cette durée se clôt de lui-même. Vide : la valeur par défaut de l’Instance (une heure, sauf si NUDGE_INCIDENT_QUIET_PERIOD_MS en fixe une autre). Une Occurrence peut fixer la sienne avec quietPeriod, en secondes.',
      save: 'Enregistrer les réglages des Incidents',
      example: 'Exemple de requête',
      exampleHelp:
        'Placez la clé secrète dans la variable d’environnement NUDGE_SECRET_KEY du serveur qui signale. Un même titre et un même Environnement sont regroupés en un seul Incident ; une empreinte regroupe des titres différents.',
    },
  },

  incidents: {
    views: 'Vues',
    view: {
      all: 'Tous',
      open: 'Ouverts',
      closed: 'Clos',
    },
    filters: 'Filtres',
    filter: { level: 'Niveau', environment: 'Environnement' },
    anyLevel: 'Tous',
    anyEnvironment: 'Tous',
    shown: (count: number, more: boolean) =>
      `${count} Incident${s(count)} affiché${s(count)}${more ? ', d’autres à charger' : ''}.`,
    noMatch: 'Aucun Incident ne correspond à ces filtres.',
    clearFilters: 'Effacer les filtres',
    emptyTitle: 'Aucun Incident signalé pour l’instant.',
    emptyHelp:
      'Les Incidents arrivent ici quand le serveur du Projet signale un problème, avec sa clé secrète.',
    emptyAction: 'Voir comment en signaler un',
    showMore: 'Afficher plus',
    occurrences: (count: number) => `${count} Occurrence${s(count)}`,
    noEnvironment: 'Aucun Environnement',
    lastSeen: 'Vu pour la dernière fois',
  },

  incident: {
    backToList: 'Retour aux Incidents',
    properties: 'Incident',
    state: 'État',
    level: 'Niveau',
    levelOrigin: 'Origine du Niveau',
    environment: 'Environnement',
    occurrences: 'Occurrences',
    firstSeen: 'Vu pour la première fois',
    lastSeen: 'Vu pour la dernière fois',
    closed: 'Clos',
    fingerprint: 'Empreinte',
    firstReport: 'Première Occurrence',
    lastReport: 'Dernière Occurrence',
    onlyReport: 'Occurrence',
    title: 'Titre',
    message: 'Message',
    declaredLevel: 'Niveau déclaré',
    notDeclared: 'Non déclaré',
    receivedAt: 'Reçue',
    context: 'Contexte',
    noContext: 'Aucun contexte.',
    noMessage: 'Aucun message.',
    deliveries: 'Envois',
    close: {
      action: 'Clore l’Incident',
      help: 'Clore l’Incident quand vous savez que le problème est terminé : ses Destinations sont prévenues, et une nouvelle Occurrence ouvrira un nouvel Incident.',
      question:
        'L’Incident sera Clos définitivement et ses Destinations prévenues. Une nouvelle Occurrence ouvrira un nouvel Incident. Le clore ?',
    },
    redispatch: {
      help: 'Redispatcher envoie l’Incident, à son Niveau actuel, aux Destinations dont le Filtre d’Incidents le retient et qui ne l’ont pas encore reçu. Les Envois existants ne sont pas touchés.',
      action: 'Redispatcher',
      noneCreated: 'Aucune autre Destination ne retient cet Incident.',
      created: (count) => `${count} Envoi${s(count)} créé${s(count)}.`,
    },
  },

  destinations: {
    add: 'Ajouter une Destination',
    intro:
      'Chaque Retour Trié part vers toutes les Destinations dont le Filtre de Retours le retient, et chaque Incident vers toutes celles dont le Filtre d’Incidents le retient.',
    noFeedback: 'Aucun Retour',
    noIncident: 'Aucun Incident',
    incidentLevelOrMore: (level) => `Incidents : ${level} ou plus`,
    incidentEnvironments: (environments) => `en ${environments}`,
    incidentConditions: (count) => `${count} condition${s(count)} de contexte`,
    emptyTitle: 'Aucune Destination : les Retours Triés ne partent nulle part.',
    emptyHelp:
      'Ajoutez-en une ci-dessous : un dépôt GitHub, une équipe Linear, un salon Slack ou Discord, ou votre propre webhook.',
    copySecretNow: (name) =>
      `Copiez maintenant le secret de « ${name} » : il ne sera plus jamais affiché.`,
    anySeverity: 'toute Gravité',
    severityOrMore: (severity) => `${severity} ou plus`,
    suspendedProblem:
      'Ses Envois échouent de façon répétée : ils sont retenus et repartiront dès qu’elle redeviendra joignable. Vérifiez sa configuration, puis testez-la.',
    regenerate: (secrets) => `Régénérer le ${secrets}`,
    regenerateQuestion: 'L’ancien secret cessera de valoir pour les prochains appels. Régénérer ?',
    deleteQuestion: 'La Destination et l’historique de ses Envois seront supprimés. Supprimer ?',
    editTitle: (name) => `Modifier ${name}`,
    testDelivered: 'Retour d’exemple livré.',
    testFailed: (failureClass, message) => `Échec (${failureClass}) : ${message}`,
    routing: {
      title: 'Routage',
      help: 'Où part chaque type de Retour Trié. Les Indésirables et les Retours En revue n’atteignent aucune Destination.',
      types: 'Types de Retour',
      destinations: 'Destinations',
      destinationCount: (count) =>
        count === 0
          ? 'Aucune Destination'
          : count === 1
            ? '1 Destination'
            : `${count} Destinations`,
      nowhere: 'Ne part nulle part',
      route: (type, destinations) => `${type} : ${destinations}.`,
      routeNowhere: (type) => `${type} : aucune Destination ne le retient.`,
    },
    form: {
      type: 'Type',
      name: 'Nom',
      acceptedTypes: 'Types retenus',
      minimumSeverity: 'Gravité minimale',
      noMinimum: 'Aucune',
      minimumSeverityHelp:
        'Un Retour sans Gravité (nudge sans Juge) n’atteint aucune Gravité minimale.',
      feedbackFilter: 'Filtre de Retours',
      feedbackFilterOn: 'Recevoir les Retours',
      incidentFilter: 'Filtre d’Incidents',
      incidentFilterOn: 'Recevoir les Incidents',
      incidentFilterOff: 'Désactivé : cette Destination ne reçoit aucun Incident.',
      minimumLevel: 'Niveau minimal',
      environments: 'Environnements',
      environmentsHelp:
        'Séparés par des virgules. Vide : tous les Environnements. Un Incident sans Environnement ne passe qu’une liste vide.',
      conditions: 'Conditions sur le contexte',
      conditionsHelp:
        'Toutes les conditions doivent être remplies. Un Incident dont le contexte n’a pas la clé est refusé.',
      noCondition: 'Aucune condition.',
      conditionKey: 'Clé du contexte',
      conditionValues: 'Vaut l’une de',
      conditionValuesHelp: 'Séparées par des virgules.',
      addCondition: 'Ajouter une condition',
      removeCondition: 'Retirer',
      removeConditionLabel: (key) => `Retirer la condition sur ${key}`,
      environmentsPlaceholder: 'production, staging',
      conditionKeyPlaceholder: 'service',
      conditionValuesPlaceholder: 'checkout, billing',
    },
  },

  destinationTypes: {
    savedUrl: 'Une URL est enregistrée (chiffrée) : laissez vide pour la garder.',
    savedToken: 'Un jeton est enregistré (chiffré) : laissez vide pour le garder.',
    savedKey: 'Une clé est enregistrée (chiffrée) : laissez vide pour la garder.',
    webhookUrl: 'URL du webhook',
    webhook: {
      url: 'URL',
      urlHelp:
        'nudge y POSTe chaque évènement en JSON signé. Les redirections ne sont pas suivies.',
      signingSecret: 'Secret de signature',
      signingSecretHelp:
        'Votre récepteur vérifie avec lui que les appels viennent de cette Instance.',
      payload: {
        title: 'Payload',
        show: 'Ce que reçoit votre récepteur',
        event: 'Évènement',
        events: {
          feedback: 'Retour',
          'incident.opened': 'Incident ouvert',
          'incident.raised': 'Incident aggravé',
          'incident.closed': 'Incident clos',
          alert: 'Alerte',
          ping: 'Ping',
        },
        eventHelp: {
          feedback:
            'Chaque Retour dispatché, et le bouton Tester avec isTest: true. Le texte est brut : encodez-le pour votre cible.',
          'incident.opened':
            'Un Incident qui s’ouvre, avec son identifiant stable : suivez l’Incident grâce à lui. Son titre, son message, son Environnement et son contexte sont bruts : encodez-les pour votre cible.',
          'incident.raised':
            'Un Incident dont le Niveau a assez monté pour atteindre cette Destination : elle ne l’avait pas reçu à son Niveau précédent. Chaque Destination reçoit un seul événement opened ou raised par Incident.',
          'incident.closed':
            'L’Incident est clos : résolu par son émetteur, clos par un Membre, ou silencieux au-delà de sa Période de calme (incident.closure). Il arrive sur l’Envoi de son ouverture. Un identifiant jamais vu est un Incident ouvert puis clos pendant que cette Destination était injoignable : il est envoyé une seule fois.',
          alert:
            'Une alerte pour les Membres : un Retour En revue ou une Destination Suspendue. Elle ne porte jamais le texte d’un Retour.',
          ping: 'La vérification de santé, tant que la Destination est Suspendue : répondez par un 2xx pour reprendre ses Envois.',
        },
        request: 'Requête',
        headers: 'En-têtes',
        body: 'Exemple de corps',
        headerHelp: {
          event: 'feedback, incident.opened, incident.raised, incident.closed, alert ou ping.',
          delivery:
            'L’identifiant stable de l’Envoi : ignorez une nouvelle tentative déjà traitée.',
          alert: 'L’identifiant stable de l’alerte : ignorez une nouvelle tentative déjà traitée.',
          timestamp:
            'Secondes Unix à la signature : refusez un appel vieux de plus de quelques minutes.',
          signature: 'HMAC-SHA256 de timestamp + « . » + corps brut, avec le secret de signature.',
        },
        verify: 'Vérifier la signature',
        verifyHelp:
          'Calculez-la sur le corps brut, avant d’analyser le JSON, et comparez en temps constant.',
      },
    },
    discord: {
      urlHelp:
        'Paramètres du salon › Intégrations › Webhooks › Copier l’URL. Stockée chiffrée, jamais réaffichée.',
      summary: 'Webhook de salon',
    },
    email: {
      recipients: 'Destinataires',
      recipientsHelp: (max) =>
        `Jusqu’à ${max} adresses, séparées par des virgules ou des retours à la ligne. Chaque Retour est un e-mail, avec sa Capture en pièce jointe.`,
      noSmtp:
        'Cette Instance n’a pas encore de serveur SMTP : les e-mails attendront qu’il soit configuré.',
      configureSmtp: 'Configurer le SMTP',
    },
    slack: {
      urlHelp:
        'Votre app Slack › Incoming Webhooks › Add New Webhook, puis choisir le canal. Stockée chiffrée, jamais réaffichée.',
      summary: 'Webhook entrant',
    },
    github: {
      token: 'Jeton d’accès',
      tokenHelp:
        'GitHub › Settings › Developer settings › Fine-grained tokens : limité à ce dépôt, permission Issues en lecture et écriture. Stocké chiffré, jamais réaffiché.',
      repository: 'Dépôt',
      repositoryPlaceholder: 'organisation/depot',
      repositoryHelp:
        'Le propriétaire et le nom du dépôt, comme dans son URL : github.com/organisation/depot.',
      summary: (repository) => `Dépôt ${repository}`,
    },
    linear: {
      apiKey: 'Clé d’API',
      apiKeyHelp:
        'Linear › Paramètres › Sécurité et accès › Clés d’API personnelles. Stockée chiffrée, jamais réaffichée.',
      team: 'Équipe',
      teamHelp: 'La clé de l’équipe : les lettres avant le numéro des issues (ENG dans ENG-123).',
      typeLabels: 'Labels posés selon le Type',
      typeLabel: (type) => `Label du Type ${type}`,
      severityLabels: 'Labels posés selon la Gravité',
      severityLabel: (severity) => `Label de la Gravité ${severity}`,
      labelsHelp:
        'Le nom du label tel qu’il s’affiche dans Linear, de l’équipe ou de l’espace de travail. Laissé vide : aucun label. Un label introuvable suspend la Destination.',
      summary: (team) => `Équipe ${team}`,
    },
  },

  settings: {
    title: 'Paramètres de l’Instance',
    description: 'Ces réglages valent pour tous les Projets et tous les Membres.',
    sections: 'Sections des paramètres',
    section: {
      judge: 'Juge',
      smtp: 'E-mail (SMTP)',
      alert: 'Destination d’alerte',
      retention: 'Rétention',
    },
    retention: {
      title: 'Rétention des Retours',
      status: {
        unlimited: 'Illimitée',
        days: (days) => (days === 1 ? '1 jour' : `${days} jours`),
      },
      unlimited: 'Rétention illimitée : aucun Retour n’est effacé automatiquement.',
      limited: (days) =>
        `Les Retours plus anciens que ${days} jours sont effacés automatiquement, avec leurs Captures.`,
      label: 'Durée de rétention (jours)',
      help: 'Vide : rétention illimitée. L’effacement est définitif.',
      save: 'Enregistrer la rétention',
      confirm: (days) =>
        `Les Retours de plus de ${days} jours et leurs Captures seront effacés définitivement à la prochaine purge. Enregistrer ?`,
    },
    alertDestination: {
      title: 'Destination d’alerte',
      save: 'Enregistrer l’alerte',
      remove: 'Retirer',
      removeQuestion: 'Plus aucune alerte ne partira. Retirer la Destination d’alerte ?',
      help: 'Prévient les Membres quand un Retour passe En revue ou qu’une Destination est Suspendue, par l’un des types de Destination. Le dashboard les signale de toute façon.',
      none: 'Aucune Destination d’alerte : les alertes ne partent nulle part.',
      status: { none: 'Aucune' },
      secretName: 'la Destination d’alerte',
      testDelivered: 'Alerte d’exemple livrée.',
    },
    smtp: {
      title: 'E-mail (SMTP)',
      status: { configured: 'Configuré', none: 'Non configuré' },
      help: 'Le serveur SMTP par lequel nudge envoie ses e-mails : les Destinations e-mail, et une Destination d’alerte e-mail. N’importe quel fournisseur convient (votre serveur, Postmark, Resend, SES…).',
      host: 'Hôte SMTP',
      port: 'Port',
      security: 'Sécurité',
      securities: {
        starttls: 'STARTTLS (port 587)',
        tls: 'TLS (port 465)',
        none: 'Aucune (port 25)',
      },
      securityHelp: {
        starttls:
          'La connexion démarre en clair et doit passer en TLS : nudge refuse un serveur qui ne le propose pas.',
        tls: 'La connexion est chiffrée dès le départ.',
        none: 'Rien n’est chiffré, mot de passe compris : seulement pour un relais sur un réseau de confiance.',
      },
      username: 'Identifiant (facultatif)',
      usernameHelp: 'Vide : le serveur accepte nudge sans authentification.',
      password: 'Mot de passe',
      passwordHelp: 'Stocké chiffré, jamais réaffiché.',
      passwordSaved:
        'Un mot de passe est enregistré (chiffré) : laissez vide pour le garder. Il est abandonné si l’hôte ou l’identifiant change.',
      fromAddress: 'Adresse d’expédition',
      fromAddressHelp:
        'L’expéditeur de chaque e-mail : une adresse depuis laquelle votre serveur SMTP peut envoyer.',
      fromName: 'Nom d’expéditeur (facultatif)',
      save: 'Enregistrer le serveur SMTP',
      test: 'Envoyer un e-mail de test',
      testing: 'Envoi…',
      testDelivered: (email) =>
        `E-mail de test envoyé à ${email} : vérifiez votre boîte de réception.`,
      remove: 'Retirer',
      removeQuestion: 'Les Destinations e-mail n’enverront plus rien. Retirer le serveur SMTP ?',
    },
    judge: {
      title: 'Juge',
      save: 'Enregistrer le Juge',
      status: { degraded: 'Mode dégradé' },
      help: 'Le modèle de décision qui trie les Retours : il répond aux questions du Triage par des probabilités, là où un modèle de chat rédigerait du texte. Choisissez où il tourne, puis lequel. Sans Juge, nudge tourne en mode dégradé : le Type déclaré est retenu, sans Gravité ni détection d’Indésirable.',
      provider: 'Fournisseur',
      none: 'Aucun (mode dégradé)',
      model: 'Modèle',
      modelHelp: (fallback) => `Le nom du modèle chez ce fournisseur. Vide : ${fallback}.`,
      serverUrl: 'URL du serveur',
      baseUrl: 'URL de base (facultative)',
      serverUrlHelp: 'L’adresse de votre serveur : nudge y appelle <URL>/v1/decisions.',
      baseUrlHelp: 'Seulement pour passer par un proxy ; vide : l’API du fournisseur.',
      apiKey: 'Clé API',
      keySaved: 'Une clé est enregistrée (chiffrée) : laissez vide pour la garder.',
      keyHelp: 'Stockée chiffrée, jamais réaffichée.',
    },
  },
};
