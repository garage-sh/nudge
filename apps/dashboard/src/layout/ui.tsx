import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { ApiError } from '../api/client.js';

const MESSAGES: Record<string, string> = {
  identifiants_invalides: 'Email ou mot de passe incorrect.',
  setup_termine: 'Le premier compte existe déjà : connectez-vous.',
  email_deja_utilise: 'Un Membre utilise déjà cet email.',
  invitation_invalide: 'Ce lien d’invitation est invalide, expiré ou déjà utilisé.',
  projet_introuvable: 'Ce Projet n’existe pas.',
  retour_introuvable: 'Ce Retour n’existe pas.',
  transition_refusee: 'Ce Retour a changé entre-temps : voici son état actuel.',
  retour_non_trie: 'Ce Retour n’est pas encore trié : il n’a pas de Verdict à corriger.',
  envoi_introuvable: 'Cet Envoi n’existe plus.',
  envoi_non_rejouable:
    'Cet Envoi est en cours ou retenu par sa Destination Suspendue : il ne se rejoue pas maintenant.',
  destination_introuvable: 'Cette Destination n’existe plus.',
  type_destination_inconnu: 'Ce type de Destination n’est pas pris en charge par cette Instance.',
  session_requise: 'Votre session a expiré : reconnectez-vous.',
};

/** Message lisible pour une erreur de l'API (code connu, détail des champs refusés) ou du réseau. */
export function errorMessage(erreur: unknown): string {
  if (!(erreur instanceof ApiError)) return 'L’Instance est injoignable. Réessayez.';
  if (erreur.code === 'requete_invalide' && erreur.corps.details?.length) {
    return erreur.corps.details.map((detail) => detail.message).join(' ');
  }
  return MESSAGES[erreur.code] ?? `Erreur inattendue (${erreur.code}).`;
}

export function ErrorMessage({ erreur }: { erreur: unknown }) {
  if (!erreur) return null;
  return (
    <p role="alert" className="alerte">
      {errorMessage(erreur)}
    </p>
  );
}

export function Loading() {
  return (
    <p className="discret" aria-live="polite">
      Loading…
    </p>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { libelle: string; aide?: ReactNode };

export function Field({ libelle, aide, id, ...input }: FieldProps) {
  const identifiant = id ?? `champ-${libelle.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className="champ">
      <label htmlFor={identifiant}>{libelle}</label>
      <input id={identifiant} {...input} />
      {aide ? <p className="aide">{aide}</p> : null}
    </div>
  );
}

/** Une clé ou un lien affiché en entier, avec un bouton de copie. */
export function CopyableValue({ valeur, libelle }: { valeur: string; libelle: string }) {
  const [copie, setCopie] = useState(false);
  const copier = async () => {
    await navigator.clipboard.writeText(valeur);
    setCopie(true);
  };
  return (
    <div className="copiable">
      <code aria-label={libelle}>{valeur}</code>
      <button type="button" className="secondaire" onClick={() => void copier()}>
        {copie ? 'Copié' : 'Copier'}
      </button>
    </div>
  );
}

/** Action irréversible en deux temps : le bouton demande une confirmation sur place. */
export function ConfirmAction({
  libelle,
  question,
  enCours,
  onConfirm,
}: {
  libelle: string;
  question: string;
  enCours?: boolean;
  onConfirm: () => void;
}) {
  const [ouverte, setOuverte] = useState(false);
  if (!ouverte) {
    return (
      <button type="button" className="secondaire" onClick={() => setOuverte(true)}>
        {libelle}
      </button>
    );
  }
  return (
    <div className="confirmation" role="group" aria-label={question}>
      <span>{question}</span>
      <button
        type="button"
        className="danger"
        disabled={enCours}
        onClick={() => {
          setOuverte(false);
          onConfirm();
        }}
      >
        Confirmer
      </button>
      <button type="button" className="secondaire" onClick={() => setOuverte(false)}>
        Annuler
      </button>
    </div>
  );
}

const estHttp = (valeur: string): boolean => {
  try {
    const { protocol } = new URL(valeur);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Une URL venue de l'extérieur (contexte d'un Retour, lien d'un Envoi) : un lien
 * seulement en http(s), sinon du texte — un `javascript:` ne devient jamais cliquable.
 */
export function LienExterne({ href }: { href: string }) {
  if (!estHttp(href)) return <span className="lien-brut">{href}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="lien-brut">
      {href}
    </a>
  );
}
