import type {
  AuthorTrust,
  DeliveryStatus,
  DestinationState,
  FailureClass,
  FeedbackState,
  FeedbackType,
  JudgeProvider,
  Severity,
  Source,
} from '@nudge/shared';

/**
 * The dashboard's copy in English, the default locale and the source of truth for the
 * keys: every other locale is typed against it (`Messages`). Domain words follow
 * CONTEXT.md, with their capitals. A sentence built with values is a function.
 */
export const en = {
  /** This locale's name, written in itself (the language selector lists them all). */
  localeName: 'English',

  labels: {
    feedbackType: {
      bug: 'Bug',
      suggestion: 'Suggestion',
      opinion: 'Opinion',
      question: 'Question',
    } satisfies Record<FeedbackType, string>,
    severity: {
      cosmetic: 'Cosmetic',
      minor: 'Minor',
      major: 'Major',
      blocking: 'Blocking',
    } satisfies Record<Severity, string>,
    feedbackState: {
      received: 'Received',
      triaged: 'Triaged',
      dispatched: 'Dispatched',
      discarded: 'Discarded',
      in_review: 'In review',
    } satisfies Record<FeedbackState, string>,
    source: {
      widget: 'Widget',
      api: 'API',
      extension: 'Extension',
    } satisfies Record<Source, string>,
    authorTrust: {
      declared: 'Declared',
      attested: 'Attested',
    } satisfies Record<AuthorTrust, string>,
    deliveryStatus: {
      pending: 'Pending',
      delivered: 'Delivered',
      failed: 'Failed',
      held: 'Held',
    } satisfies Record<DeliveryStatus, string>,
    destinationState: {
      active: 'Active',
      suspended: 'Suspended',
    } satisfies Record<DestinationState, string>,
    /** A Delivery's failure class, as a Member reads it. */
    failureClass: {
      transient: 'temporarily unavailable',
      auth: 'credentials refused',
      permanent: 'refused by the Destination',
    } satisfies Record<FailureClass, string>,
    judgeProvider: {
      typesafe: 'TypeSafe',
      openrouter: 'OpenRouter',
      self_hosted: 'Your server (Decisions API)',
    } satisfies Record<JudgeProvider, string>,
    /**
     * What each Judge provider is: where the decision model runs, and which one is picked
     * there. The model is never the provider's name.
     */
    judgeProviderDescription: {
      typesafe: 'TypeSafe’s decision models, with your TypeSafe API key.',
      openrouter:
        'The decision models OpenRouter offers through its Decisions API, with your OpenRouter API key.',
      self_hosted:
        'The decision model of your choice, served by your own server: any server that exposes the Decisions API will do. The key is optional.',
    } satisfies Record<JudgeProvider, string>,
  },

  /** Stable API error codes (`{ error }`), in plain words with the action to take. */
  apiErrors: {
    invalid_credentials: 'Incorrect email or password.',
    setup_completed: 'The first account already exists: sign in.',
    email_already_used: 'A Member already uses this email.',
    invalid_invitation: 'This invitation link is invalid, expired or already used.',
    project_not_found: 'This Project does not exist.',
    feedback_not_found: 'This Feedback does not exist.',
    transition_refused: 'This Feedback changed in the meantime: here is its current state.',
    storage_unavailable:
      'The Capture could not be erased from storage: the Feedback is kept. Try again later.',
    feedback_not_triaged: 'This Feedback is not triaged yet: it has no Verdict to correct.',
    delivery_not_found: 'This Delivery no longer exists.',
    delivery_not_replayable:
      'This Delivery is in progress or held by its Suspended Destination: it cannot be replayed now.',
    feedback_not_redispatchable:
      'This Feedback cannot be redispatched: only a Triaged or Dispatched Feedback can.',
    destination_not_found: 'This Destination no longer exists.',
    unknown_destination_type: 'This Instance does not support this Destination type.',
    session_required: 'Your session has expired: sign in again.',
  },
  unreachable: 'The Instance cannot be reached. Try again.',
  unexpectedError: (code: string) => `Unexpected error (${code}).`,

  common: {
    retry: 'Retry',
    saved: 'Saved.',
    loading: 'Loading…',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    close: 'Close',
    test: 'Test',
    edit: 'Edit',
    delete: 'Delete',
    copy: 'Copy',
    copied: 'Copied',
    copiedToClipboard: 'Copied to the clipboard.',
    copyManually: 'Automatic copy failed: the text is selected, copy it with ⌘C or Ctrl+C.',
    language: 'Language',
  },

  time: {
    justNow: 'just now',
    minutesAgo: (minutes: number) => `${minutes} min ago`,
    hoursAgo: (hours: number) => `${hours} h ago`,
    yesterdayAt: (time: string) => `yesterday, ${time}`,
    today: 'Today',
    yesterday: 'Yesterday',
  },

  /** Byte units, powers of 1024. */
  units: { bytes: 'B', kibibytes: 'KiB', mebibytes: 'MiB' },

  layout: {
    menu: 'Menu',
    closeMenu: 'Close menu',
    mainNavigation: 'Main navigation',
    instanceNavigation: 'Instance',
    inbox: 'Inbox',
    projects: 'Projects',
    members: 'Members',
    settings: 'Settings',
    signOut: 'Sign out',
    inReviewTitle: 'Feedback in review',
    inReviewHidden: ', Feedback in review: ',
    thisWeekTitle: 'Feedback received in the last seven days',
    thisWeekHidden: ', Feedback this week: ',
  },

  alerts: {
    region: 'Alerts',
    inReview: (count: number) => `${count} Feedback in review`,
    suspended: (destination: string, project: string) =>
      `Suspended Destination: ${destination} (${project})`,
  },

  badges: {
    uncertain: 'Uncertain',
    uncertainTitle: 'The Judge hesitated: worth checking',
    noSeverity: 'No Severity',
    severity: (label: string) => `Severity ${label}`,
  },

  account: {
    email: 'Email',
    password: 'Password',
    passwordHelp: (min: number) => `At least ${min} characters.`,
  },

  signIn: {
    title: 'Sign in',
    submit: 'Sign in',
  },

  setup: {
    title: 'Create the first account',
    intro: 'This Instance has no Member yet. The account created here can invite the others.',
    submit: 'Create the account',
  },

  invitation: {
    title: 'Invitation',
    askAgainBefore: 'Ask a Member for a new link, or ',
    signInLink: 'sign in',
    askAgainAfter: '.',
    joinTitle: 'Join the Instance',
    intro: 'You are invited to join this nudge Instance. Create your Member account.',
    submit: 'Create my account',
  },

  notFound: {
    title: 'Page not found',
    empty: 'This address leads to no screen.',
    back: 'Back to the Inbox',
    help: 'The link may be incomplete, or the item was deleted.',
  },

  members: {
    title: 'Members',
    description:
      'Every Member sees every Project. To invite someone, generate a link and send it to them: it works only once.',
    generate: 'Generate an invitation link',
    invitationLink: 'Invitation link',
    validUntil: (date: string) =>
      `Valid until ${date}, for a single account. A new link does not revoke the previous ones.`,
    list: 'Members of the Instance',
    you: ' (you)',
    since: (date: string) => `Member since ${date}`,
  },

  inbox: {
    title: 'Inbox',
    views: 'Views',
    view: {
      all: 'All',
      in_review: 'In review',
      received: 'Received',
      triaged: 'Triaged',
      dispatched: 'Dispatched',
      discarded: 'Discarded',
    } satisfies Record<FeedbackState | 'all', string>,
    filters: 'Filters',
    filter: {
      project: 'Project',
      type: 'Type',
      severity: 'Severity',
      source: 'Source',
      uncertain: 'Verdict',
    },
    anyProject: 'All',
    anyType: 'All',
    anySeverity: 'All',
    anySource: 'All',
    anyVerdict: 'All',
    uncertainOnly: 'Uncertain only',
    withoutUncertain: 'Without Uncertain',
    shown: (count: number, more: boolean) =>
      `${count} Feedback shown${more ? ', more to load' : ''}.`,
    noMatch: 'No Feedback matches these filters.',
    clearFilters: 'Clear filters',
    emptyTitle: 'No Feedback yet.',
    emptyHelp:
      'Feedback arrives here as soon as a Project receives some, through the Widget or the API. A Project’s page gives its keys.',
    showMore: 'Show more',
    shortcutsNextPrevious: 'next or previous Feedback,',
    shortcutsEscape: 'Esc',
    shortcutsClose: 'close',
    openFeedback: 'Open Feedback',
    notTriaged: 'Not triaged',
  },

  feedback: {
    heading: (text: string) => `Feedback: ${text}`,
    text: 'Feedback text',
    declaredType: (type: string) => `Type declared by the Author: ${type}`,
    trail: 'Trail',
    backToInbox: '← Inbox',
    position: (position: number, total: number) => `${position} of ${total}`,
    previous: 'Previous',
    next: 'Next',
    properties: 'Feedback properties',
    sections: {
      review: 'Review',
      capture: 'Capture',
      deliveries: 'Deliveries',
      verdict: 'Verdict',
      author: 'Author',
      context: 'Context',
      deletion: 'Deletion',
    },
    review: {
      inReview:
        'The Judge suspects an attempt at Manipulation of Triage: this Feedback was sent nowhere. Approve it to dispatch it, or reject it.',
      junk: 'Discarded as Junk. If it is genuine Feedback, reinstate it: it will be dispatched as usual.',
      approve: 'Approve',
      reject: 'Reject',
      rejectQuestion:
        'Rejected, the Feedback is Discarded and can no longer be reinstated. Reject?',
      reinstate: 'Reinstate',
    },
    deletion: {
      help: (withCapture: boolean) =>
        `Permanently erases this Feedback${withCapture ? ' and its Capture' : ''}, for example for an erasure request from the Author. What was already created in the Destinations (issues, messages) is not touched.`,
      question: 'The Feedback will be permanently erased. Delete?',
    },
    capture: {
      alt: 'Capture of the page attached by the Author',
      open: 'Open the image',
    },
    verdict: {
      notTriaged: 'This Feedback is not triaged yet.',
      resolvedType: 'Resolved type',
      severity: 'Severity',
      notAssessed: 'Not assessed',
      junk: 'Junk',
      manipulation: 'Manipulation',
      correct: 'Correct',
      correctionHelp:
        'The correction changes nothing in the Destinations already served: replay a Delivery to pass it on to them, or redispatch the Feedback to send it to the Destinations whose Filter now accepts it.',
    },
    author: {
      anonymous: 'Anonymous',
      name: 'Name',
      email: 'Email',
      id: 'Identifier',
      trust: 'Identity',
    },
    context: {
      page: 'Page',
      browser: 'Browser',
      screen: 'Screen',
      none: 'No context sent.',
      metadata: 'Metadata',
    },
    deliveries: {
      none: 'No Delivery.',
      attempts: (count: number) => `${count} ${count === 1 ? 'attempt' : 'attempts'}`,
      replay: 'Replay',
      lastError: (error: string) => `Last error: ${error}`,
    },
    redispatch: {
      help: 'Redispatching sends the Feedback, according to its current Verdict, to the Destinations whose Filter accepts it and that have not received it yet. Existing Deliveries are not touched.',
      action: 'Redispatch',
      noneCreated: 'No other Destination accepts this Feedback.',
      created: (count: number) => `${count} ${count === 1 ? 'Delivery' : 'Deliveries'} created.`,
    },
  },

  projects: {
    title: 'Projects',
    description:
      'Each Project is an application whose Feedback nudge collects, with its own keys and Destinations.',
    new: 'New Project',
    emptyTitle: 'No Project yet.',
    emptyHelp:
      'Create the first one above: you will get its keys to connect the Widget or the API.',
    list: 'Projects of the Instance',
    thisWeek: (count: number) => `${count} Feedback this week`,
    inReview: (count: number) => `${count} In review`,
    noDestination: 'No Destination',
    destinations: (count: number) => `${count} ${count === 1 ? 'Destination' : 'Destinations'}`,
    destinationsSuspended: (count: number, suspended: number) =>
      `${count} ${count === 1 ? 'Destination' : 'Destinations'}, ${suspended} Suspended`,
    name: 'Project name',
    create: 'Create Project',
  },

  project: {
    fallbackTitle: 'Project',
    sections: 'Project sections',
    destinationsTab: 'Destinations',
    settingsTab: 'Settings',
    keys: 'Keys',
    publicKey: 'Public key',
    publicKeyHelp: 'For the Widget; accepted only from the allowed origins.',
    regeneratePublicKey: 'Regenerate public key',
    regeneratePublicKeyQuestion: 'The old public key will stop working. Regenerate?',
    secretKey: 'Secret key',
    secretKeyHelp: 'To send Feedback from a server. Never publish it.',
    copySecretKeyNow: 'Copy the secret key now: it will never be shown again.',
    secretKeyShownOnce: 'Shown only once, when created. Lost it? Regenerate it.',
    regenerateSecretKey: 'Regenerate secret key',
    regenerateSecretKeyQuestion: 'The old secret key will stop working immediately. Regenerate?',
    details: 'Details',
    description: 'Project description',
    descriptionHelp:
      'Optional. Tell the Judge what the Project is and what is critical in it, so it can assess Severity better.',
    allowedOrigins: 'Allowed origins',
    originsLabel: 'One origin per line',
    originsHelp: 'The Widget is accepted only from these origins (scheme://host[:port], no path).',
  },

  destinations: {
    add: 'Add Destination',
    intro: 'Each Triaged Feedback goes to every Destination whose Filter accepts it.',
    emptyTitle: 'No Destination: Triaged Feedback goes nowhere.',
    emptyHelp:
      'Add one above: a GitHub repository, a Linear team, a Slack or Discord channel, or your own webhook.',
    copySecretNow: (name: string) =>
      `Copy the secret of “${name}” now: it will never be shown again.`,
    anySeverity: 'any Severity',
    severityOrMore: (severity: string) => `${severity} or higher`,
    suspendedProblem:
      'Its Deliveries fail repeatedly: they are held and will go out again as soon as it is reachable. Check its configuration, then test it.',
    regenerate: (secrets: string) => `Regenerate ${secrets}`,
    regenerateQuestion: 'The old secret will stop working for the next calls. Regenerate?',
    deleteQuestion: 'The Destination and the history of its Deliveries will be deleted. Delete?',
    editTitle: (name: string) => `Edit ${name}`,
    testDelivered: 'Sample Feedback delivered.',
    testFailed: (failureClass: string, message: string) => `Failed (${failureClass}): ${message}`,
    form: {
      type: 'Type',
      name: 'Name',
      acceptedTypes: 'Accepted types',
      minimumSeverity: 'Minimum Severity',
      noMinimum: 'None',
      minimumSeverityHelp:
        'A Feedback without Severity (nudge without a Judge) reaches no minimum Severity.',
      add: 'Add',
    },
  },

  /** The fields of each Destination type. */
  destinationTypes: {
    savedUrl: 'A URL is saved (encrypted): leave empty to keep it.',
    savedToken: 'A token is saved (encrypted): leave empty to keep it.',
    savedKey: 'A key is saved (encrypted): leave empty to keep it.',
    webhookUrl: 'Webhook URL',
    webhook: {
      url: 'URL',
      urlHelp:
        'nudge POSTs each Feedback there as JSON: event, isTest, delivery, project and feedback (alert instead, for the Alert destination). Headers: X-Nudge-Event (feedback, alert or ping), X-Nudge-Delivery or X-Nudge-Alert, X-Nudge-Timestamp, and X-Nudge-Signature: sha256=HMAC(secret, X-Nudge-Timestamp + "." + raw body).',
      signingSecret: 'Signing secret',
      signingSecretHelp: 'Your receiver uses it to check that calls come from this Instance.',
    },
    discord: {
      urlHelp:
        'Channel settings › Integrations › Webhooks › Copy Webhook URL. Stored encrypted, never shown again.',
      summary: 'Channel webhook',
    },
    slack: {
      urlHelp:
        'Your Slack app › Incoming Webhooks › Add New Webhook, then pick the channel. Stored encrypted, never shown again.',
      summary: 'Incoming webhook',
    },
    github: {
      token: 'Access token',
      tokenHelp:
        'GitHub › Settings › Developer settings › Fine-grained tokens: limited to this repository, with read and write access to Issues. Stored encrypted, never shown again.',
      repository: 'Repository',
      repositoryPlaceholder: 'organization/repository',
      repositoryHelp:
        'The repository’s owner and name, as in its URL: github.com/organization/repository.',
      summary: (repository: string) => `Repository ${repository}`,
    },
    linear: {
      apiKey: 'API key',
      apiKeyHelp:
        'Linear › Settings › Security & access › Personal API keys. Stored encrypted, never shown again.',
      team: 'Team',
      teamHelp: 'The team’s key: the letters before the issue number (ENG in ENG-123).',
      typeLabels: 'Labels set by type',
      typeLabel: (type: string) => `Label for type ${type}`,
      severityLabels: 'Labels set by Severity',
      severityLabel: (severity: string) => `Label for Severity ${severity}`,
      labelsHelp:
        'The label’s name as Linear shows it, from the team or the workspace. Left empty: no label. A label that cannot be found suspends the Destination.',
      summary: (team: string) => `Team ${team}`,
    },
  },

  settings: {
    title: 'Instance settings',
    description: 'These settings apply to every Project and every Member.',
    retention: {
      title: 'Feedback retention',
      unlimited: 'Unlimited retention: no Feedback is erased automatically.',
      limited: (days: number) =>
        `Feedback older than ${days} days is erased automatically, with its Captures.`,
      label: 'Retention period (days)',
      help: 'Empty: unlimited retention. Erasure is permanent.',
      save: 'Save retention',
      confirm: (days: number) =>
        `Feedback older than ${days} days and its Captures will be permanently erased at the next purge. Save?`,
    },
    alertDestination: {
      title: 'Alert destination',
      save: 'Save alert destination',
      remove: 'Remove',
      removeQuestion: 'No alert will go out anymore. Remove the Alert destination?',
      help: 'Notifies Members when a Feedback goes In review or a Destination is Suspended, through one of the Destination types. The dashboard shows them anyway.',
      saved: (type: string) => `Saved: ${type}.`,
      none: 'No Alert destination: alerts go nowhere.',
      secretName: 'the Alert destination',
      testDelivered: 'Sample alert delivered.',
    },
    judge: {
      title: 'Judge',
      help: 'The decision model that triages Feedback: it answers Triage’s questions with probabilities, where a chat model would write text. Choose where it runs, then which one. Without a Judge, nudge runs in degraded mode: the declared type is kept, with no Severity and no Junk detection.',
      provider: 'Provider',
      none: 'None (degraded mode)',
      model: 'Model',
      modelHelp: (fallback: string) => `The model’s name at this provider. Empty: ${fallback}.`,
      serverUrl: 'Server URL',
      baseUrl: 'Base URL (optional)',
      serverUrlHelp: 'Your server’s address: nudge calls <URL>/v1/decisions there.',
      baseUrlHelp: 'Only to go through a proxy; empty: the provider’s API.',
      apiKey: 'API key',
      keySaved: 'A key is saved (encrypted): leave empty to keep it.',
      keyHelp: 'Stored encrypted, never shown again.',
    },
  },
};

export type Messages = typeof en;
