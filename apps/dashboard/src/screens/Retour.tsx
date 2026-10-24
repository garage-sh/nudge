import {
  estEnvoiRejouable,
  GRAVITES,
  TYPES_RETOUR,
  type ActionRevue,
  type AuteurVu,
  type Contexte,
  type EnvoiVu,
  type Gravite,
  type RetourDetailVu,
  type TypeRetour,
  type VerdictVu,
} from '@nudge/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useCorrectionVerdict, useRejeu, useRetour, useRevue } from '../api/retours.js';
import {
  formatDate,
  LIBELLES_CONFIANCE,
  LIBELLES_ETAT,
  LIBELLES_ETAT_DESTINATION,
  LIBELLES_GRAVITE,
  LIBELLES_SOURCE,
  LIBELLES_STATUT_ENVOI,
  LIBELLES_TYPE,
} from '../libelles.js';
import { ConfirmAction, ErrorMessage, LienExterne, Loading } from '../layout/ui.js';
import { BadgeIncertain } from './retour-badges.js';

/**
 * Détail d'un Retour. Tout ce que l'Auteur a fourni (texte, identité, contexte)
 * est rendu comme du texte : jamais de HTML, jamais de lien hors http(s).
 * Les actions de revue, la Capture et la suppression s'ajoutent comme sections.
 */
export function Retour() {
  const id = useParams().id ?? '';
  // Après une action, le Retour est relu le temps que le worker en tire les suites.
  const [suivreJusqua, setSuivreJusqua] = useState(0);
  const suivre = () => setSuivreJusqua(Date.now() + SUIVI_APRES_ACTION_MS);
  const retour = useRetour(id, { suivreJusqua });
  if (retour.isPending) return <Loading />;
  if (retour.isError) return <ErrorMessage erreur={retour.error} />;
  const detail = retour.data;
  return (
    <article className="retour">
      <p className="discret">
        <Link to="/retours">Boîte de réception</Link>
      </p>
      <h1>Retour</h1>
      <p className="meta">
        <Link to={`/projets/${detail.projet.id}`}>{detail.projet.nom}</Link>
        <span>{LIBELLES_ETAT[detail.etat]}</span>
        <span>{LIBELLES_SOURCE[detail.source]}</span>
        <time dateTime={detail.createdAt}>{formatDate(detail.createdAt)}</time>
      </p>
      <p className="texte-retour" aria-label="Texte du Retour">
        {detail.texte}
      </p>
      {detail.typeDeclare ? (
        <p className="discret">Type déclaré par l’Auteur : {LIBELLES_TYPE[detail.typeDeclare]}</p>
      ) : null}
      {actionsDeRevue(detail).length > 0 ? (
        <Section id="revue" titre="Revue">
          <Revue retour={detail} apresAction={suivre} />
        </Section>
      ) : null}
      <Section id="verdict" titre="Verdict">
        <Verdict retourId={detail.id} verdict={detail.verdict} />
      </Section>
      <Section id="auteur" titre="Auteur">
        <Auteur auteur={detail.auteur} />
      </Section>
      <Section id="contexte" titre="Contexte">
        <ContexteRetour contexte={detail.contexte} />
      </Section>
      <Section id="envois" titre="Envois">
        <Envois retourId={detail.id} envois={detail.envois} apresRejeu={suivre} />
      </Section>
    </article>
  );
}

/** Durée pendant laquelle le Retour est relu après une action du Membre. */
const SUIVI_APRES_ACTION_MS = 15_000;

/** Les actions de revue possibles sur ce Retour (l'api fait foi, et refuse les autres). */
function actionsDeRevue(retour: RetourDetailVu): ActionRevue[] {
  if (retour.etat === 'en_revue') return ['valider', 'rejeter'];
  // Seul un Retour Écarté comme Indésirable se réhabilite, pas un Retour rejeté après revue.
  if (retour.etat === 'ecarte' && retour.verdict?.indesirable && !retour.verdict.manipulation) {
    return ['rehabiliter'];
  }
  return [];
}

function Revue({ retour, apresAction }: { retour: RetourDetailVu; apresAction: () => void }) {
  const revue = useRevue(retour.id);
  const agir = (action: ActionRevue) => revue.mutate(action, { onSuccess: apresAction });
  const actions = actionsDeRevue(retour);
  return (
    <>
      {retour.etat === 'en_revue' ? (
        <p>
          Le Juge soupçonne une tentative de Manipulation du Triage : ce Retour n’a été envoyé nulle
          part. Validez-le pour le dispatcher, ou rejetez-le.
        </p>
      ) : (
        <p>
          Écarté comme Indésirable. S’il s’agit d’un vrai Retour, réhabilitez-le : il sera dispatché
          normalement.
        </p>
      )}
      <div className="actions">
        {actions.includes('valider') ? (
          <button type="button" disabled={revue.isPending} onClick={() => agir('valider')}>
            Valider
          </button>
        ) : null}
        {actions.includes('rejeter') ? (
          <ConfirmAction
            libelle="Rejeter"
            question="Rejeté, le Retour est Écarté et ne pourra plus être réhabilité. Rejeter ?"
            enCours={revue.isPending}
            onConfirm={() => agir('rejeter')}
          />
        ) : null}
        {actions.includes('rehabiliter') ? (
          <button type="button" disabled={revue.isPending} onClick={() => agir('rehabiliter')}>
            Réhabiliter
          </button>
        ) : null}
      </div>
      <ErrorMessage erreur={revue.error} />
    </>
  );
}

function Section({ id, titre, children }: { id: string; titre: string; children: ReactNode }) {
  return (
    <section className="encadre" aria-labelledby={`retour-${id}`}>
      <h2 id={`retour-${id}`}>{titre}</h2>
      {children}
    </section>
  );
}

/** Liste de couples libellé / valeur, valeurs rendues comme du texte. */
function Proprietes({ lignes }: { lignes: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="proprietes">
      {lignes.map(([libelle, valeur]) => (
        <div key={libelle}>
          <dt>{libelle}</dt>
          <dd>{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}

function Verdict({ retourId, verdict }: { retourId: string; verdict: VerdictVu | null }) {
  const [enCorrection, setEnCorrection] = useState(false);
  if (!verdict) return <p className="discret">Ce Retour n’est pas encore trié.</p>;
  if (enCorrection) {
    return (
      <FormulaireCorrection
        retourId={retourId}
        verdict={verdict}
        fermer={() => setEnCorrection(false)}
      />
    );
  }
  return (
    <>
      <Proprietes
        lignes={[
          ['Type retenu', LIBELLES_TYPE[verdict.typeRetenu]],
          ['Gravité', verdict.gravite ? LIBELLES_GRAVITE[verdict.gravite] : 'Non évaluée'],
        ]}
      />
      <p className="meta">
        {verdict.incertain ? <BadgeIncertain /> : null}
        {verdict.indesirable ? <span className="badge">Indésirable</span> : null}
        {verdict.manipulation ? <span className="badge">Manipulation</span> : null}
      </p>
      <div className="actions">
        <button type="button" className="secondaire" onClick={() => setEnCorrection(true)}>
          Corriger
        </button>
      </div>
    </>
  );
}

/**
 * Le Membre corrige le Type retenu et la Gravité. Les Destinations déjà servies ne
 * voient pas la correction : le rejeu d'un Envoi la leur propage.
 */
function FormulaireCorrection({
  retourId,
  verdict,
  fermer,
}: {
  retourId: string;
  verdict: VerdictVu;
  fermer: () => void;
}) {
  const correction = useCorrectionVerdict(retourId);
  const [typeRetenu, setTypeRetenu] = useState<TypeRetour>(verdict.typeRetenu);
  const [gravite, setGravite] = useState<Gravite | ''>(verdict.gravite ?? '');
  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    correction.mutate(
      { typeRetenu, ...(gravite ? { gravite } : {}) },
      { onSuccess: () => fermer() },
    );
  };
  return (
    <form onSubmit={soumettre} className="formulaire">
      <p className="aide">
        La correction ne change rien chez les Destinations déjà servies : rejouez un Envoi pour la
        leur propager.
      </p>
      <div className="champ">
        <label htmlFor="correction-type">Type retenu</label>
        <select
          id="correction-type"
          value={typeRetenu}
          onChange={(e) => setTypeRetenu(e.target.value as TypeRetour)}
        >
          {TYPES_RETOUR.map((valeur) => (
            <option key={valeur} value={valeur}>
              {LIBELLES_TYPE[valeur]}
            </option>
          ))}
        </select>
      </div>
      <div className="champ">
        <label htmlFor="correction-gravite">Gravité</label>
        <select
          id="correction-gravite"
          value={gravite}
          onChange={(e) => setGravite(e.target.value as Gravite | '')}
        >
          {/* Une Gravité non évaluée (mode dégradé) se fixe, mais ne s'efface pas. */}
          {verdict.gravite ? null : <option value="">Non évaluée</option>}
          {GRAVITES.map((valeur) => (
            <option key={valeur} value={valeur}>
              {LIBELLES_GRAVITE[valeur]}
            </option>
          ))}
        </select>
      </div>
      <ErrorMessage erreur={correction.error} />
      <div className="actions">
        <button type="submit" disabled={correction.isPending}>
          Enregistrer
        </button>
        <button type="button" className="secondaire" onClick={fermer}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function Auteur({ auteur }: { auteur: AuteurVu | null }) {
  if (!auteur) return <p className="discret">Anonyme</p>;
  const lignes: [string, ReactNode][] = [];
  if (auteur.nom) lignes.push(['Nom', auteur.nom]);
  if (auteur.email) lignes.push(['Email', auteur.email]);
  if (auteur.id) lignes.push(['Identifiant', auteur.id]);
  lignes.push(['Identité', LIBELLES_CONFIANCE[auteur.confiance]]);
  return <Proprietes lignes={lignes} />;
}

function ContexteRetour({ contexte }: { contexte: Contexte }) {
  const lignes: [string, ReactNode][] = [];
  if (contexte.url) lignes.push(['Page', <LienExterne key="url" href={contexte.url} />]);
  if (contexte.userAgent) lignes.push(['Navigateur', contexte.userAgent]);
  if (contexte.viewport) {
    lignes.push(['Écran', `${contexte.viewport.largeur} × ${contexte.viewport.hauteur}`]);
  }
  const metadonnees = Object.entries(contexte.metadonnees ?? {});
  if (lignes.length === 0 && metadonnees.length === 0) {
    return <p className="discret">Aucun contexte transmis.</p>;
  }
  return (
    <>
      {lignes.length > 0 ? <Proprietes lignes={lignes} /> : null}
      {metadonnees.length > 0 ? (
        <>
          <h3>Métadonnées</h3>
          <Proprietes lignes={metadonnees.map(([cle, valeur]) => [cle, String(valeur)])} />
        </>
      ) : null}
    </>
  );
}

/**
 * Les Envois, avec leur statut et le lien vers l'objet créé. Un Envoi livré ou en
 * échec se rejoue, avec le Verdict courant : pour rattraper un échec ou propager une
 * correction.
 */
function Envois({
  retourId,
  envois,
  apresRejeu,
}: {
  retourId: string;
  envois: readonly EnvoiVu[];
  apresRejeu: () => void;
}) {
  const rejeu = useRejeu(retourId);
  if (envois.length === 0) {
    return <p className="discret">Aucun Envoi.</p>;
  }
  return (
    <ul className="liste">
      {envois.map((envoi) => (
        <li key={envoi.id}>
          <p className="meta">
            <strong>{envoi.destination.nom}</strong>
            <span>{envoi.destination.type}</span>
            {envoi.destination.etat !== 'active' ? (
              <span className="badge">{LIBELLES_ETAT_DESTINATION[envoi.destination.etat]}</span>
            ) : null}
            <span>{LIBELLES_STATUT_ENVOI[envoi.statut]}</span>
            <span>
              {envoi.tentatives} tentative{envoi.tentatives > 1 ? 's' : ''}
            </span>
          </p>
          {envoi.lienExterne ? <LienExterne href={envoi.lienExterne} /> : null}
          {envoi.derniereErreur ? <p className="alerte">{envoi.derniereErreur}</p> : null}
          {estEnvoiRejouable(envoi.statut) ? (
            <div className="actions">
              <button
                type="button"
                className="secondaire"
                disabled={rejeu.isPending}
                onClick={() => rejeu.mutate(envoi.id, { onSuccess: apresRejeu })}
              >
                Rejouer
              </button>
            </div>
          ) : null}
          {rejeu.variables === envoi.id ? <ErrorMessage erreur={rejeu.error} /> : null}
        </li>
      ))}
    </ul>
  );
}
