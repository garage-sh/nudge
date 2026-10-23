import { LIMITES_DASHBOARD } from '@nudge/shared';
import { useState, type FormEvent } from 'react';
import { Champ, MessageErreur } from '../mise-en-page/ui.js';

/** Email + mot de passe : connexion, ou création d'un compte (setup, invitation). */
export function FormulaireCompte({
  action,
  nouveauCompte,
  enCours,
  erreur,
  onSubmit,
}: {
  action: string;
  nouveauCompte: boolean;
  enCours: boolean;
  erreur: unknown;
  onSubmit: (identifiants: { email: string; motDePasse: string }) => void;
}) {
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    onSubmit({ email, motDePasse });
  };
  return (
    <form onSubmit={soumettre} className="formulaire">
      <Champ
        libelle="Email"
        type="email"
        autoComplete={nouveauCompte ? 'email' : 'username'}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Champ
        libelle="Mot de passe"
        type="password"
        autoComplete={nouveauCompte ? 'new-password' : 'current-password'}
        required
        minLength={nouveauCompte ? LIMITES_DASHBOARD.motDePasseMin : undefined}
        aide={nouveauCompte ? `${LIMITES_DASHBOARD.motDePasseMin} caractères au moins.` : undefined}
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
      />
      <MessageErreur erreur={erreur} />
      <button type="submit" disabled={enCours}>
        {action}
      </button>
    </form>
  );
}
