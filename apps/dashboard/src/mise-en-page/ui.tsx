import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { ErreurApi } from '../api/client.js';

const MESSAGES: Record<string, string> = {
  identifiants_invalides: 'Email ou mot de passe incorrect.',
  setup_termine: 'Le premier compte existe déjà : connectez-vous.',
  email_deja_utilise: 'Un Membre utilise déjà cet email.',
  invitation_invalide: 'Ce lien d’invitation est invalide, expiré ou déjà utilisé.',
  projet_introuvable: 'Ce Projet n’existe pas.',
  session_requise: 'Votre session a expiré : reconnectez-vous.',
};

/** Message lisible pour une erreur de l'API (code connu, détail des champs refusés) ou du réseau. */
export function messageErreur(erreur: unknown): string {
  if (!(erreur instanceof ErreurApi)) return 'L’Instance est injoignable. Réessayez.';
  if (erreur.code === 'requete_invalide' && erreur.corps.details?.length) {
    return erreur.corps.details.map((detail) => detail.message).join(' ');
  }
  return MESSAGES[erreur.code] ?? `Erreur inattendue (${erreur.code}).`;
}

export function MessageErreur({ erreur }: { erreur: unknown }) {
  if (!erreur) return null;
  return (
    <p role="alert" className="alerte">
      {messageErreur(erreur)}
    </p>
  );
}

export function Chargement() {
  return (
    <p className="discret" aria-live="polite">
      Chargement…
    </p>
  );
}

type ChampProps = InputHTMLAttributes<HTMLInputElement> & { libelle: string; aide?: ReactNode };

export function Champ({ libelle, aide, id, ...input }: ChampProps) {
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
export function ValeurCopiable({ valeur, libelle }: { valeur: string; libelle: string }) {
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
export function ActionConfirmee({
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
