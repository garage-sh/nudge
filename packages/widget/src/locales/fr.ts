import type { Messages } from './en.js';

/** Texts shown to the Author, in French. */
export const fr: Messages = {
  launcher: 'Laisser un retour',
  title: 'Laisser un retour',
  subtitle: 'Un bug, une idée, une question ? Dites-nous tout.',
  close: 'Fermer',
  text: 'Votre message',
  textPlaceholder: 'Ce qui s’est passé, ce que vous attendiez, ou votre idée…',
  textEmpty: 'Écrivez votre message avant d’envoyer.',
  type: 'Type (facultatif)',
  feedbackTypes: {
    bug: 'Bug',
    suggestion: 'Suggestion',
    opinion: 'Avis',
    question: 'Question',
  },
  email: 'Email (facultatif)',
  emailPlaceholder: 'vous@exemple.fr',
  attachCapture: 'Joindre une capture de la page',
  captureInProgress: 'Capture de la page en cours…',
  captureHelp:
    'Tracez un rectangle sur l’aperçu pour flouter une zone. Les zones sensibles de l’application sont déjà masquées.',
  capturePreview: 'Aperçu de la capture',
  clearBlurs: 'Retirer les flous',
  enlargeCapture: 'Agrandir',
  editorDone: 'Terminé',
  captureFailed: 'La capture de la page a échoué : envoyez votre retour sans elle.',
  captureTooLarge: 'La capture est trop lourde pour être envoyée : retirez-la, puis réessayez.',
  submit: 'Envoyer',
  submitting: 'Envoi…',
  sent: 'Merci ! Votre retour a bien été envoyé.',
  sendAnother: 'Envoyer un autre retour',
  network: 'Envoi impossible : vérifiez votre connexion, puis réessayez.',
  invalid:
    'Votre retour n’a pas été accepté : vérifiez le message, l’email et la capture, puis réessayez.',
  unavailable: 'Le service de retours est momentanément indisponible. Réessayez plus tard.',
  configuration: 'Le formulaire de retour est mal configuré : votre retour n’a pas pu être envoyé.',
  rateLimited: (minutes) =>
    `Trop de retours envoyés en peu de temps. Réessayez ${
      minutes === null
        ? 'dans quelques minutes'
        : minutes === 1
          ? 'dans une minute'
          : `dans ${minutes} minutes`
    }.`,
};
