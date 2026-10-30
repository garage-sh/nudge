import type {
  AuthorTrust,
  DeliveryStatus,
  DestinationState,
  FailureClass,
  FeedbackState,
  FeedbackType,
  IncidentCloseCause,
  IncidentState,
  JudgeProvider,
  Level,
  LevelOrigin,
  Severity,
  SmtpSecurity,
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
    level: {
      info: 'Info',
      warning: 'Warning',
      error: 'Error',
      critical: 'Critical',
    } satisfies Record<Level, string>,
    /** Where an Incident's Level came from. */
    levelOrigin: {
      declared: 'Declared by the sender',
      judge: 'Assessed by the Judge',
      default: 'Project’s default Level',
    } satisfies Record<LevelOrigin, string>,
    incidentState: {
      open: 'Open',
      closed: 'Closed',
    } satisfies Record<IncidentState, string>,
    /** Why an Incident closed. */
    closeCause: {
      resolved: 'Resolved by its sender',
      member: 'Closed by a Member',
      quiet_period: 'Quiet period over',
    } satisfies Record<IncidentCloseCause, string>,
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
    incident_not_found: 'This Incident does not exist.',
    transition_refused: 'This Feedback changed in the meantime: here is its current state.',
    storage_unavailable:
      'The Capture could not be erased from storage: the Feedback is kept. Try again later.',
    feedback_not_triaged: 'This Feedback is not triaged yet: it has no Verdict to correct.',
    delivery_not_found: 'This Delivery no longer exists.',
    delivery_not_replayable:
      'This Delivery is in progress, held by its Suspended Destination, or an Incident Delivery already delivered: it cannot be replayed now.',
    feedback_not_redispatchable:
      'This Feedback cannot be redispatched: only a Triaged or Dispatched Feedback can.',
    incident_not_redispatchable: 'This Incident cannot be redispatched: only an Open Incident can.',
    destination_not_found: 'This Destination no longer exists.',
    unknown_destination_type: 'This Instance does not support this Destination type.',
    session_required: 'Your session has expired: sign in again.',
    server_busy: 'The Instance is busy checking other passwords. Try again in a moment.',
    invalid_setup_token:
      'This setup token is incorrect: copy it from the nudge server logs, or from NUDGE_SETUP_TOKEN.',
    invalid_current_password: 'Your current password is incorrect.',
    member_not_found: 'This Member no longer exists.',
    cannot_remove_self: 'You cannot remove yourself: ask another Member to do it.',
    too_many_attempts: 'Too many attempts: wait a minute, then try again.',
    smtp_missing: 'No SMTP server is saved: save one first.',
  },
  unreachable: 'The Instance cannot be reached. Try again.',
  unexpectedError: (code: string) => `Unexpected error (${code}).`,

  /** A field the browser refuses, said under it in the dashboard's language. */
  validation: {
    required: 'Required.',
    email: 'Enter an email address, like name@example.com.',
    url: 'Enter a full URL, starting with https://.',
    tooShort: (min: number) => `At least ${min} characters.`,
    tooLong: (max: number) => `At most ${max} characters.`,
    min: (min: string) => `At least ${min}.`,
    max: (max: string) => `At most ${max}.`,
    wholeNumber: 'Enter a whole number.',
    invalid: 'Check this value.',
  },

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
    token: 'Setup token',
    tokenHelp:
      'It proves you run this Instance: the nudge server prints it in its logs at startup (docker compose logs nudge), unless NUDGE_SETUP_TOKEN sets it.',
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

  crash: {
    title: 'Something went wrong',
    help: 'This screen stopped on an unexpected error. Reload the page; if it happens again, report it with the steps that led here.',
    reload: 'Reload',
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
    remove: 'Remove',
    removeLabel: (email: string) => `Remove ${email}`,
    removeQuestion: (email: string) => `Remove ${email}? Their sessions end at once.`,
    removed: (email: string) => `${email} is no longer a Member.`,
  },

  /** The signed-in Member's own account, on the Members screen. */
  ownAccount: {
    title: 'Your account',
    currentPassword: 'Current password',
    newPassword: 'New password',
    changePassword: 'Change password',
    passwordChanged: 'Password changed. Your other sessions are signed out.',
    sessionsTitle: 'Sessions',
    sessionsHelp:
      'A lost device, a shared computer: sign out everywhere else. This session stays open.',
    signOutOthers: 'Sign out everywhere else',
    signedOutOthers: (count: number) =>
      count === 0
        ? 'No other session was open.'
        : `${count} other session${count > 1 ? 's' : ''} signed out.`,
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
      uncertainHelp:
        'The Judge hesitated on this Verdict: check the type and Severity, and correct them if needed.',
      degradedHelp:
        'Triaged without a Judge: the type declared by the Author is kept, with no Severity.',
      setUpJudge: 'Set up a Judge',
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
      replayLabel: (destination: string) => `Replay the Delivery to ${destination}`,
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
      'Create the first one below: you will get its keys to connect the Widget or the API.',
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
    incidentsTab: 'Incidents',
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
    saveDetails: 'Save details',
    description: 'Project description',
    descriptionHelp:
      'Optional. Tell the Judge what the Project is and what is critical in it, so it can assess Severity better.',
    allowedOrigins: 'Allowed origins',
    originsLabel: 'One origin per line',
    originsHelp: 'The Widget is accepted only from these origins (scheme://host[:port], no path).',
    saveOrigins: 'Save origins',
    incidents: {
      title: 'Incidents',
      help: 'Your application reports an Incident when something goes wrong on its side, from its server only, with the secret key.',
      defaultLevel: 'Default Level',
      defaultLevelHelp:
        'The Level of an Incident whose sender declares none, when the Judge gives none in time.',
      quietPeriod: 'Quiet period (minutes)',
      quietPeriodHelp:
        'An Incident with no new Occurrence for this long closes on its own. Empty: the Instance default (one hour, unless NUDGE_INCIDENT_QUIET_PERIOD_MS sets another). An Occurrence can set its own with quietPeriod, in seconds.',
      openingCap: 'Opening cap (Incidents per minute)',
      openingCapHelp:
        'Past this many Incidents opened in a minute, the next ones are recorded but Held: they go to no Destination. The Alert destination is warned once per storm, and each Destination concerned gets a single summary once the Project is back under its cap. Empty: the Instance default (20, unless NUDGE_INCIDENT_OPENING_CAP sets another).',
      save: 'Save Incident settings',
      example: 'Example request',
      exampleHelp:
        'Put the secret key in the NUDGE_SECRET_KEY environment variable of the server that reports. The same title and Environment are grouped into one Incident; a fingerprint groups different titles.',
    },
  },

  incidents: {
    views: 'Views',
    view: {
      all: 'All',
      open: 'Open',
      closed: 'Closed',
    } satisfies Record<IncidentState | 'all', string>,
    filters: 'Filters',
    filter: { level: 'Level', environment: 'Environment', held: 'Dispatch' },
    anyLevel: 'All',
    anyEnvironment: 'All',
    anyDispatch: 'All',
    heldOnly: 'Held only',
    shown: (count: number, more: boolean) =>
      `${count} Incident${count === 1 ? '' : 's'} shown${more ? ', more to load' : ''}.`,
    noMatch: 'No Incident matches these filters.',
    noneInView: { open: 'No Open Incident.', closed: 'No Closed Incident.' },
    clearFilters: 'Clear filters',
    invalidFilters: 'This address carries filters nudge does not know.',
    emptyTitle: 'No Incident reported yet.',
    emptyHelp:
      'Incidents arrive here when the Project’s server reports something going wrong, with its secret key.',
    emptyAction: 'See how to report one',
    showMore: 'Show more',
    occurrences: (count: number) => `${count} Occurrence${count === 1 ? '' : 's'}`,
    noEnvironment: 'No Environment',
    lastSeen: 'Last seen',
    held: 'Held',
    heldTitle: 'Opened past the Project’s Opening cap: not dispatched.',
  },

  incident: {
    backToList: 'Back to Incidents',
    properties: 'Incident',
    state: 'State',
    level: 'Level',
    levelOrigin: 'Level from',
    environment: 'Environment',
    occurrences: 'Occurrences',
    firstSeen: 'First seen',
    lastSeen: 'Last seen',
    closed: 'Closed',
    fingerprint: 'Fingerprint',
    firstReport: 'First Occurrence',
    lastReport: 'Last Occurrence',
    onlyReport: 'Occurrence',
    title: 'Title',
    message: 'Message',
    declaredLevel: 'Declared Level',
    notDeclared: 'Not declared',
    receivedAt: 'Received',
    context: 'Context',
    noContext: 'No context.',
    noMessage: 'No message.',
    deliveries: 'Deliveries',
    heldHelp:
      'Opened while the Project went past its Opening cap: recorded, but sent to no Destination. Redispatch it if it matters; the Destinations concerned get a summary of the Held Incidents instead.',
    heldClosedHelp:
      'Opened while the Project went past its Opening cap: recorded, but sent to no Destination. Closed, it can no longer be Redispatched.',
    close: {
      action: 'Close Incident',
      help: 'Close it once you know the problem is over: its Destinations are told, and a new Occurrence will open a new Incident.',
      question:
        'The Incident will be Closed for good and its Destinations told. A new Occurrence will open a new Incident. Close it?',
      done: 'Incident closed: its Destinations are being told.',
    },
    deletion: {
      title: 'Deletion',
      help: 'Permanently erases this Incident and the history of its Deliveries, for example when personal data leaked into a report. What was already created in the Destinations (issues, messages) is not touched, and a new Occurrence will open a new Incident.',
      question: 'The Incident will be permanently erased. Delete?',
    },
    redispatch: {
      help: 'Redispatching sends the Incident, at its current Level, to the Destinations whose Incident Filter accepts it and that have not received it yet. Existing Deliveries are not touched.',
      action: 'Redispatch',
      pending: 'Redispatching…',
      noneCreated: 'No other Destination accepts this Incident.',
      created: (count: number) => `${count} ${count === 1 ? 'Delivery' : 'Deliveries'} created.`,
    },
  },

  destinations: {
    add: 'Add Destination',
    intro:
      'Each Triaged Feedback goes to every Destination whose Feedback Filter accepts it, and each Incident to every Destination whose Incident Filter accepts it.',
    noFeedback: 'No Feedback',
    noIncident: 'No Incident',
    incidentLevelOrMore: (level: string) => `Incidents: ${level} or higher`,
    incidentEnvironments: (environments: string) => `in ${environments}`,
    incidentConditions: (count: number) =>
      `${count} context ${count === 1 ? 'condition' : 'conditions'}`,
    emptyTitle: 'No Destination: Triaged Feedback and Incidents go nowhere.',
    emptyHelp:
      'Add one below: a GitHub repository, a Linear team, a Slack, Discord or Telegram channel, or your own webhook.',
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
    routing: {
      title: 'Routing',
      help: 'Where each type of Triaged Feedback goes. Junk and Feedback In review reach no Destination.',
      types: 'Feedback types',
      destinations: 'Destinations',
      destinationCount: (count: number) =>
        count === 0 ? 'No Destination' : count === 1 ? '1 Destination' : `${count} Destinations`,
      nowhere: 'Goes nowhere',
      route: (type: string, destinations: string) => `${type}: ${destinations}.`,
      routeNowhere: (type: string) => `${type}: no Destination accepts it.`,
    },
    form: {
      type: 'Type',
      name: 'Name',
      acceptedTypes: 'Accepted types',
      minimumSeverity: 'Minimum Severity',
      noMinimum: 'None',
      minimumSeverityHelp:
        'A Feedback without Severity (nudge without a Judge) reaches no minimum Severity.',
      feedbackFilter: 'Feedback Filter',
      feedbackFilterOn: 'Receive Feedback',
      incidentFilter: 'Incident Filter',
      incidentFilterOn: 'Receive Incidents',
      incidentFilterOff: 'Off: this Destination receives no Incident.',
      minimumLevel: 'Minimum Level',
      environments: 'Environments',
      environmentsHelp:
        'Separated by commas. Empty: every Environment. An Incident without an Environment passes only an empty list.',
      conditions: 'Context conditions',
      conditionsHelp:
        'Every condition must hold. An Incident whose context lacks the key is refused.',
      noCondition: 'No condition.',
      conditionKey: 'Context key',
      conditionValues: 'Is one of',
      conditionValuesHelp: 'Separated by commas.',
      addCondition: 'Add a condition',
      removeCondition: 'Remove',
      removeConditionLabel: (key: string) => `Remove the condition on ${key}`,
      environmentsPlaceholder: 'production, staging',
      conditionKeyPlaceholder: 'service',
      conditionValuesPlaceholder: 'checkout, billing',
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
      urlHelp: 'nudge POSTs each event there as signed JSON. Redirects are not followed.',
      signingSecret: 'Signing secret',
      signingSecretHelp: 'Your receiver uses it to check that calls come from this Instance.',
      payload: {
        title: 'Payload',
        show: 'What your receiver gets',
        event: 'Event',
        events: {
          feedback: 'Feedback',
          'incident.opened': 'Incident opened',
          'incident.raised': 'Incident raised',
          'incident.closed': 'Incident closed',
          'incidents.held': 'Incidents held',
          alert: 'Alert',
          ping: 'Ping',
        },
        eventHelp: {
          feedback:
            'Each dispatched Feedback, and the Test button with isTest: true. The text is raw: encode it for your target.',
          'incident.opened':
            'An Incident that opened, with its stable id: track the Incident by it. Its title, message, Environment and context are raw: encode them for your target.',
          'incident.raised':
            'An Incident whose Level rose enough to reach this Destination: it had not received it at its previous Level. Each Destination gets a single opened or raised event per Incident.',
          'incident.closed':
            'The Incident closed: resolved by its sender, closed by a Member, or silent past its Quiet period (incident.closure). It comes on the Delivery of its opening. An id you never saw is an Incident that opened and closed while this Destination was unreachable: it is delivered once.',
          'incidents.held':
            'The summary of a storm: the Project opened Incidents faster than its Opening cap, and those past it were held. Once it is back under its cap, a single summary (count, time range, link) comes in place of the Incidents this Destination would have received.',
          alert:
            'An alert for the Members: a Feedback In review, a Suspended Destination, or a Project opening Incidents faster than its Opening cap. It never carries a Feedback’s text.',
          ping: 'The health check, while the Destination is Suspended: answer with a 2xx to resume its Deliveries.',
        },
        request: 'Request',
        headers: 'Headers',
        body: 'Example body',
        headerHelp: {
          event:
            'feedback, incident.opened, incident.raised, incident.closed, incidents.held, alert or ping.',
          delivery: 'The Delivery’s stable id: ignore a retry you already processed.',
          summary: 'The summary’s stable id: ignore a retry you already processed.',
          alert: 'The alert’s stable id: ignore a retry you already processed.',
          timestamp: 'Unix seconds at signing: reject a call older than a few minutes.',
          signature: 'HMAC-SHA256 of timestamp + "." + raw body, with the signing secret.',
        },
        verify: 'Verify the signature',
        verifyHelp:
          'Compute it on the raw body, before parsing the JSON, and compare in constant time.',
      },
    },
    discord: {
      urlHelp:
        'Channel settings › Integrations › Webhooks › Copy Webhook URL. Stored encrypted, never shown again.',
      summary: 'Channel webhook',
    },
    email: {
      recipients: 'Recipients',
      recipientsHelp: (max: number) =>
        `Up to ${max} addresses, separated by commas or line breaks. Each Feedback is one email, with its Capture attached.`,
      noSmtp: 'This Instance has no SMTP server yet: emails will wait until one is configured.',
      configureSmtp: 'Configure SMTP',
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
    telegram: {
      botToken: 'Bot token',
      botTokenHelp:
        'In Telegram, send /newbot to @BotFather and paste the token it gives you. Stored encrypted, never shown again.',
      chatId: 'Chat id',
      chatIdHelp:
        'Add the bot to the group or channel (as an administrator for a channel), post a message there, then open api.telegram.org/bot<token>/getUpdates: the id is chat.id, -100… for a supergroup or a channel. A public channel can be given as @username; a person must start the bot first.',
      topicId: 'Forum topic (optional)',
      topicIdHelp:
        'In a group with topics, the topic’s id: the last number of a link to the topic (t.me/c/…/7). Empty: the chat itself.',
      summary: (chatId: string, topicId: number | null) =>
        topicId === null ? `Chat ${chatId}` : `Chat ${chatId}, topic ${topicId}`,
    },
  },

  settings: {
    title: 'Instance settings',
    description: 'These settings apply to every Project and every Member.',
    sections: 'Settings sections',
    section: {
      judge: 'Judge',
      smtp: 'Email (SMTP)',
      alert: 'Alert destination',
      retention: 'Retention',
    },
    retention: {
      title: 'Retention',
      status: {
        unlimited: 'Unlimited',
        days: (days: number) => (days === 1 ? '1 day' : `${days} days`),
      },
      unlimited: 'Unlimited retention: no Feedback or Incident is erased automatically.',
      limited: (days: number) =>
        `Feedback older than ${days} days is erased automatically, with its Captures, and so are Incidents last seen more than ${days} days ago.`,
      label: 'Retention period (days)',
      help: 'Empty: unlimited retention. Erasure is permanent.',
      save: 'Save retention',
      confirm: (days: number) =>
        `Feedback older than ${days} days and its Captures, and Incidents last seen more than ${days} days ago, will be permanently erased at the next purge. Save?`,
    },
    alertDestination: {
      title: 'Alert destination',
      save: 'Save alert destination',
      remove: 'Remove',
      removeQuestion: 'No alert will go out anymore. Remove the Alert destination?',
      help: 'Notifies Members when a Feedback goes In review or a Destination is Suspended, through one of the Destination types. The dashboard shows them anyway.',
      none: 'No Alert destination: alerts go nowhere.',
      status: { none: 'None' },
      secretName: 'the Alert destination',
      testDelivered: 'Sample alert delivered.',
    },
    smtp: {
      title: 'Email (SMTP)',
      status: { configured: 'Configured', none: 'Not configured' },
      help: 'The SMTP server through which nudge sends email: the email Destinations, and an email Alert destination. Any provider works (your own server, Postmark, Resend, SES…).',
      host: 'SMTP host',
      port: 'Port',
      security: 'Security',
      securities: {
        starttls: 'STARTTLS (port 587)',
        tls: 'TLS (port 465)',
        none: 'None (port 25)',
      } satisfies Record<SmtpSecurity, string>,
      securityHelp: {
        starttls:
          'The connection starts in clear and must switch to TLS: nudge refuses a server that does not offer it.',
        tls: 'The connection is encrypted from the start.',
        none: 'Nothing is encrypted, password included: only for a relay on a network you trust.',
      } satisfies Record<SmtpSecurity, string>,
      username: 'Username (optional)',
      usernameHelp: 'Empty: the server accepts nudge without authentication.',
      password: 'Password',
      passwordHelp: 'Stored encrypted, never shown again.',
      passwordSaved:
        'A password is saved (encrypted): leave empty to keep it. It is dropped if the host or the username changes.',
      fromAddress: 'From address',
      fromAddressHelp: 'The sender of every email: an address your SMTP server may send from.',
      fromName: 'From name (optional)',
      save: 'Save SMTP server',
      test: 'Send test email',
      testing: 'Sending…',
      testDelivered: (email: string) => `Test email sent to ${email}: check your inbox.`,
      remove: 'Remove',
      removeQuestion: 'Email Destinations will stop sending. Remove the SMTP server?',
    },
    judge: {
      title: 'Judge',
      save: 'Save Judge',
      status: { degraded: 'Degraded mode' },
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
