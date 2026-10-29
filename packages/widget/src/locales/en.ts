import type { FeedbackType } from '@nudge/shared';

/** Texts shown to the Author, in English (the default locale). */
export const en = {
  launcher: 'Send feedback',
  title: 'Send feedback',
  subtitle: 'A bug, an idea, a question? Tell us about it.',
  close: 'Close',
  text: 'Your message',
  textPlaceholder: 'What happened, what you expected, or your idea…',
  textEmpty: 'Write your message before sending.',
  type: 'Type (optional)',
  feedbackTypes: {
    bug: 'Bug',
    suggestion: 'Suggestion',
    opinion: 'Opinion',
    question: 'Question',
  } satisfies Record<FeedbackType, string>,
  email: 'Email (optional)',
  emailPlaceholder: 'you@example.com',
  attachCapture: 'Attach a screenshot of the page',
  captureInProgress: 'Taking a screenshot of the page…',
  captureHelp:
    'Draw a rectangle on the preview to blur an area. Sensitive areas of the app are already masked.',
  capturePreview: 'Screenshot preview',
  clearBlurs: 'Remove blurs',
  captureFailed: 'The screenshot failed: send your feedback without it.',
  captureTooLarge: 'The screenshot is too large to send: remove it, then try again.',
  submit: 'Send',
  submitting: 'Sending…',
  sent: 'Thank you! Your feedback has been sent.',
  sendAnother: 'Send more feedback',
  network: 'Could not send: check your connection, then try again.',
  invalid:
    'Your feedback was not accepted: check the message, the email and the screenshot, then try again.',
  unavailable: 'The feedback service is temporarily unavailable. Try again later.',
  configuration: 'The feedback form is misconfigured: your feedback could not be sent.',
  /** 429: `minutes` until the Instance accepts feedback again, `null` if unknown. */
  rateLimited: (minutes: number | null): string =>
    `Too much feedback sent in a short time. Try again ${
      minutes === null
        ? 'in a few minutes'
        : minutes === 1
          ? 'in a minute'
          : `in ${minutes} minutes`
    }.`,
};

/** The shape every locale must provide: same keys, same functions. */
export type Messages = typeof en;
