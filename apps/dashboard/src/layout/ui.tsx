import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client.js';

/** Vrai tant que la media query correspond ; faux là où `matchMedia` n'existe pas. */
export function useMediaQuery(requete: string): boolean {
  return useSyncExternalStore(
    (prevenir: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const liste = window.matchMedia(requete);
      liste.addEventListener('change', prevenir);
      return () => liste.removeEventListener('change', prevenir);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(requete).matches,
    () => false,
  );
}

const MESSAGES: Record<string, string> = {
  identifiants_invalides: 'Email ou mot de passe incorrect.',
  setup_termine: 'Le premier compte existe déjà : connectez-vous.',
  email_deja_utilise: 'Un Membre utilise déjà cet email.',
  invitation_invalide: 'Ce lien d’invitation est invalide, expiré ou déjà utilisé.',
  projet_introuvable: 'Ce Projet n’existe pas.',
  retour_introuvable: 'Ce Retour n’existe pas.',
  transition_refusee: 'Ce Retour a changé entre-temps : voici son état actuel.',
  stockage_indisponible:
    'La Capture n’a pas pu être effacée du stockage : le Retour est gardé. Réessayez plus tard.',
  retour_non_trie: 'Ce Retour n’est pas encore trié : il n’a pas de Verdict à corriger.',
  envoi_introuvable: 'Cet Envoi n’existe plus.',
  envoi_non_rejouable:
    'Cet Envoi est en cours ou retenu par sa Destination Suspendue : il ne se rejoue pas maintenant.',
  retour_non_redispatchable:
    'Ce Retour ne peut pas être redispatché : seul un Retour Trié ou Dispatché se redispatche.',
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

/** L'erreur, en clair ; `onRetry` ajoute « Réessayer » (une lecture qui a échoué). */
export function ErrorMessage({ erreur, onRetry }: { erreur: unknown; onRetry?: () => void }) {
  if (!erreur) return null;
  return (
    <p role="alert" className="alerte">
      <span>{errorMessage(erreur)}</span>
      {onRetry ? (
        <button type="button" className="secondaire" onClick={onRetry}>
          Réessayer
        </button>
      ) : null}
    </p>
  );
}

/**
 * « Enregistré. », annoncé : une région `status` toujours présente, remplie après un
 * enregistrement réussi. Le formulaire l'efface dès qu'on le modifie (`reset` de la mutation).
 */
export function StatutEnregistrement({ enregistre }: { enregistre: boolean }) {
  return (
    <p role="status" className="statut-enregistrement">
      {enregistre ? 'Enregistré.' : ''}
    </p>
  );
}

/** Chargement : des silhouettes de lignes, annoncées comme « Chargement… ». */
export function Loading() {
  return (
    <div className="chargement" aria-live="polite">
      <span className="visuellement-cache">Chargement…</span>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

/**
 * En-tête d'un écran : le titre (seul `h1` de l'écran), un lien de retour facultatif
 * au-dessus, une description et les actions de l'écran à droite.
 */
export function PageHeader({
  titre,
  retour,
  description,
  actions,
}: {
  titre: ReactNode;
  retour?: { to: string; libelle: string };
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="entete-page">
      <div>
        {retour ? (
          <Link to={retour.to} className="retour-lien">
            ← {retour.libelle}
          </Link>
        ) : null}
        <h1>{titre}</h1>
        {description ? <p className="description">{description}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}

/** Rien à montrer : dit pourquoi et, quand il y en a une, propose l'action qui remplit l'écran. */
export function EmptyState({
  titre,
  children,
  action,
}: {
  titre: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="vide">
      <p>
        <strong>{titre}</strong>
      </p>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/** Ton d'une pastille : la couleur sémantique d'un état (voir docs/design-system.md). */
export type Ton = 'neutre' | 'succes' | 'revue' | 'danger' | 'retenu' | 'eteint';

/** Un État ou un Statut, en pastille colorée par son ton. */
export function Pastille({
  ton,
  children,
  title,
}: {
  ton: Ton;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge pastille ton-${ton}`} title={title}>
      {children}
    </span>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { libelle: string; aide?: ReactNode };

export function Field({ libelle, aide, id, ...input }: FieldProps) {
  const genere = useId();
  const identifiant = id ?? genere;
  return (
    <div className="champ">
      <label htmlFor={identifiant}>{libelle}</label>
      <input id={identifiant} {...input} />
      {aide ? <p className="aide">{aide}</p> : null}
    </div>
  );
}

/**
 * Une clé ou un lien affiché en entier, avec un bouton de copie. Sans presse-papier
 * (origine http, refus du navigateur), le texte est sélectionné pour une copie à la main.
 */
export function CopyableValue({ valeur, libelle }: { valeur: string; libelle: string }) {
  const code = useRef<HTMLElement>(null);
  const [etat, setEtat] = useState<'repos' | 'copie' | 'manuelle'>('repos');
  useEffect(() => {
    if (etat !== 'copie') return;
    const delai = setTimeout(() => setEtat('repos'), 2000);
    return () => clearTimeout(delai);
  }, [etat]);
  const selectionner = () => {
    const element = code.current;
    const selection = window.getSelection();
    if (!element || !selection) return;
    const plage = document.createRange();
    plage.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(plage);
  };
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(valeur);
      setEtat('copie');
    } catch {
      selectionner();
      setEtat('manuelle');
    }
  };
  return (
    <div className="copiable">
      <code ref={code} aria-label={libelle}>
        {valeur}
      </code>
      <button type="button" className="secondaire" onClick={() => void copier()}>
        {etat === 'copie' ? 'Copié' : 'Copier'}
      </button>
      <span role="status" className={etat === 'manuelle' ? 'aide' : 'visuellement-cache'}>
        {etat === 'copie'
          ? 'Copié dans le presse-papier.'
          : etat === 'manuelle'
            ? 'Copie automatique impossible : le texte est sélectionné, copiez-le avec ⌘C ou Ctrl+C.'
            : ''}
      </span>
    </div>
  );
}

/**
 * Rend le focus à un bouton quand ce qu'il a ouvert (un formulaire, une édition) se
 * referme : `ouvert` passe de vrai à faux. Renvoie la ref à poser sur ce bouton.
 */
export function useFocusAuRetour(ouvert: boolean) {
  const bouton = useRef<HTMLButtonElement>(null);
  const etaitOuvert = useRef(ouvert);
  useEffect(() => {
    if (etaitOuvert.current && !ouvert) bouton.current?.focus();
    etaitOuvert.current = ouvert;
  }, [ouvert]);
  return bouton;
}

/**
 * La question d'une confirmation sur place, avec Confirmer et Annuler. Le focus va sur
 * Annuler (le choix sûr) ; Échap annule.
 */
export function Confirmation({
  question,
  enCours,
  onConfirm,
  onAnnuler,
}: {
  question: string;
  enCours?: boolean;
  onConfirm: () => void;
  onAnnuler: () => void;
}) {
  const annuler = useRef<HTMLButtonElement>(null);
  useEffect(() => annuler.current?.focus(), []);
  return (
    <div
      className="confirmation"
      role="group"
      aria-label={question}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // Échap ferme la confirmation, pas ce qui l'entoure (le volet d'un Retour).
        e.stopPropagation();
        onAnnuler();
      }}
    >
      <span>{question}</span>
      <button type="button" className="danger" disabled={enCours} onClick={onConfirm}>
        Confirmer
      </button>
      <button ref={annuler} type="button" className="secondaire" onClick={onAnnuler}>
        Annuler
      </button>
    </div>
  );
}

/**
 * Action irréversible en deux temps : le bouton demande une confirmation sur place.
 * Fermée, la confirmation rend le focus au bouton d'origine.
 */
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
  const declencheur = useRef<HTMLButtonElement>(null);
  const aRendreLeFocus = useRef(false);
  useEffect(() => {
    if (!ouverte && aRendreLeFocus.current) {
      aRendreLeFocus.current = false;
      declencheur.current?.focus();
    }
  }, [ouverte]);
  const fermer = () => {
    aRendreLeFocus.current = true;
    setOuverte(false);
  };
  if (!ouverte) {
    return (
      <button
        ref={declencheur}
        type="button"
        className="secondaire"
        onClick={() => setOuverte(true)}
      >
        {libelle}
      </button>
    );
  }
  return (
    <Confirmation
      question={question}
      enCours={enCours}
      onAnnuler={fermer}
      onConfirm={() => {
        fermer();
        onConfirm();
      }}
    />
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
