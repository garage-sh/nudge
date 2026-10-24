import {
  actionsDeRevuePermises,
  estEnvoiRejouable,
  estRetourRedispatchable,
  GRAVITES,
  TYPES_RETOUR,
  urlCapture,
  type ActionRevue,
  type AuteurVu,
  type CaptureVue,
  type Contexte,
  type EnvoiVu,
  type Gravite,
  type RetourDetailVu,
  type TypeRetour,
  type VerdictVu,
} from '@nudge/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  useCorrectionVerdict,
  useRedispatch,
  useRejeu,
  useRetour,
  useRevue,
  useSuppressionRetour,
} from '../api/retours.js';
import {
  formatDate,
  formatDateRelative,
  LIBELLES_CONFIANCE,
  LIBELLES_GRAVITE,
  LIBELLES_SOURCE,
  LIBELLES_TYPE,
} from '../libelles.js';
import { ConfirmAction, ErrorMessage, LienExterne, Loading, Pastille } from '../layout/ui.js';
import {
  BadgeIncertain,
  JaugeGravite,
  PastilleEtat,
  PastilleEtatDestination,
  PastilleStatutEnvoi,
} from './retour-badges.js';
import type { ListeState } from './Retours.js';

/**
 * Détail d'un Retour. Tout ce que l'Auteur a fourni (texte, identité, contexte)
 * est rendu comme du texte : jamais de HTML, jamais de lien hors http(s).
 * Chaque partie (revue, Verdict, Capture, Envois, suppression…) est une section.
 */
export function Retour() {
  const id = useParams().id ?? '';
  // Après une action, le Retour est relu le temps que le worker en tire les suites.
  const [suivreJusqua, setSuivreJusqua] = useState(0);
  const suivre = () => setSuivreJusqua(Date.now() + SUIVI_APRES_ACTION_MS);
  const retour = useRetour(id, { suivreJusqua });
  const liste = (useLocation().state as ListeState | null)?.liste;
  const versListe = liste?.recherche ? `/retours?${liste.recherche}` : '/retours';
  if (retour.isPending) return <Loading />;
  if (retour.isError) {
    return (
      <>
        <Fil versListe={versListe} />
        <ErrorMessage erreur={retour.error} />
      </>
    );
  }
  const detail = retour.data;
  const { verdict } = detail;
  return (
    <article className="retour">
      <Fil versListe={versListe} id={detail.id} liste={liste} />
      <h1 className="visuellement-cache">Retour</h1>
      <div className="retour-grille">
        <div className="retour-principal">
          <header className="titre-retour">
            <JaugeGravite gravite={verdict?.gravite} grande />
            <div>
              <p className="texte-retour" aria-label="Texte du Retour">
                {detail.texte}
              </p>
              <p className="meta">
                <PastilleEtat etat={detail.etat} />
                <Link to={`/projets/${detail.projet.id}`}>{detail.projet.nom}</Link>
                <span>{LIBELLES_SOURCE[detail.source]}</span>
                <time dateTime={detail.createdAt} title={formatDate(detail.createdAt)}>
                  {formatDateRelative(detail.createdAt)}
                </time>
                {detail.typeDeclare ? (
                  <span>Type déclaré par l’Auteur : {LIBELLES_TYPE[detail.typeDeclare]}</span>
                ) : null}
              </p>
            </div>
          </header>
          {actionsDeRevuePermises(detail.etat, detail.verdict).length > 0 ? (
            <section className="bandeau-revue" aria-labelledby="retour-revue">
              <h2 id="retour-revue">Revue</h2>
              <Revue retour={detail} apresAction={suivre} />
            </section>
          ) : null}
          {detail.capture ? (
            <Section id="capture" titre="Capture">
              <Capture retourId={detail.id} capture={detail.capture} />
            </Section>
          ) : null}
          <Section id="envois" titre="Envois">
            <Envois retourId={detail.id} envois={detail.envois} apresRejeu={suivre} />
            {estRetourRedispatchable(detail.etat) ? (
              <Redispatch retourId={detail.id} apresRedispatch={suivre} />
            ) : null}
          </Section>
        </div>
        <aside className="retour-cote" aria-label="Propriétés du Retour">
          <Section id="verdict" titre="Verdict">
            <Verdict retourId={detail.id} verdict={detail.verdict} />
          </Section>
          <Section id="auteur" titre="Auteur">
            <Auteur auteur={detail.auteur} />
          </Section>
          <Section id="contexte" titre="Contexte">
            <ContexteRetour contexte={detail.contexte} />
          </Section>
          <Section id="suppression" titre="Suppression">
            <Suppression retour={detail} />
          </Section>
        </aside>
      </div>
    </article>
  );
}

/**
 * Le fil au-dessus du Retour : retour à la liste d'où il a été ouvert (filtres
 * compris), et Retour précédent / suivant dans cette liste.
 */
function Fil({
  versListe,
  id,
  liste,
}: {
  versListe: string;
  id?: string;
  liste?: ListeState['liste'];
}) {
  const position = id && liste ? liste.ids.indexOf(id) : -1;
  const precedent = position > 0 ? liste?.ids[position - 1] : undefined;
  const suivant = position >= 0 ? liste?.ids[position + 1] : undefined;
  const state: ListeState = { liste };
  return (
    <nav className="fil" aria-label="Fil">
      <Link to={versListe} className="retour-lien">
        ← Boîte de réception
      </Link>
      {position >= 0 && liste ? (
        <span className="precedent-suivant">
          <span className="discret">
            {position + 1} sur {liste.ids.length}
          </span>
          {precedent ? (
            <Link to={`/retours/${precedent}`} state={state}>
              Précédent
            </Link>
          ) : (
            <span aria-disabled="true">Précédent</span>
          )}
          {suivant ? (
            <Link to={`/retours/${suivant}`} state={state}>
              Suivant
            </Link>
          ) : (
            <span aria-disabled="true">Suivant</span>
          )}
        </span>
      ) : null}
    </nav>
  );
}

/** Durée pendant laquelle le Retour est relu après une action du Membre. */
const SUIVI_APRES_ACTION_MS = 15_000;

function Revue({ retour, apresAction }: { retour: RetourDetailVu; apresAction: () => void }) {
  const revue = useRevue(retour.id);
  const agir = (action: ActionRevue) => revue.mutate(action, { onSuccess: apresAction });
  // L'api fait foi, et refuse les autres actions.
  const actions = actionsDeRevuePermises(retour.etat, retour.verdict);
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

/**
 * Effacer le Retour, pour répondre à une demande d'effacement : sa Capture est
 * effacée du stockage avec lui. Les objets déjà créés chez les Destinations restent.
 */
function Suppression({ retour }: { retour: RetourDetailVu }) {
  const navigate = useNavigate();
  const suppression = useSuppressionRetour(retour.id, () => void navigate('/retours'));
  return (
    <>
      <p className="aide">
        Efface définitivement ce Retour{retour.capture ? ' et sa Capture' : ''}, par exemple pour
        une demande d’effacement de l’Auteur. Ce qui a déjà été créé chez les Destinations (issues,
        messages) n’est pas touché.
      </p>
      <div className="actions">
        <ConfirmAction
          libelle="Supprimer"
          question="Le Retour sera effacé définitivement. Supprimer ?"
          enCours={suppression.isPending}
          onConfirm={() => suppression.mutate()}
        />
      </div>
      <ErrorMessage erreur={suppression.error} />
    </>
  );
}

/**
 * La Capture jointe par l'Auteur, déjà masquée et floutée dans son navigateur.
 * L'image est servie par l'api avec la session du Membre.
 */
function Capture({ retourId, capture }: { retourId: string; capture: CaptureVue }) {
  const url = urlCapture(retourId);
  return (
    <figure className="capture">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt="Capture de la page jointe par l’Auteur" loading="lazy" />
      </a>
      <figcaption className="discret">
        {FORMATS_CAPTURE[capture.contentType]} · {formatOctets(capture.octets)} ·{' '}
        <a href={url} target="_blank" rel="noopener noreferrer">
          Ouvrir l’image
        </a>
      </figcaption>
    </figure>
  );
}

const FORMATS_CAPTURE: Record<CaptureVue['contentType'], string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
};

const formatOctets = (octets: number): string =>
  octets < 1024
    ? `${octets} o`
    : octets < 1024 * 1024
      ? `${Math.round(octets / 1024)} Kio`
      : `${(octets / (1024 * 1024)).toFixed(1).replace('.', ',')} Mio`;

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
          [
            'Gravité',
            verdict.gravite ? <JaugeGravite gravite={verdict.gravite} visible /> : 'Non évaluée',
          ],
        ]}
      />
      {verdict.incertain || verdict.indesirable || verdict.manipulation ? (
        <p className="meta">
          {verdict.incertain ? <BadgeIncertain /> : null}
          {verdict.indesirable ? <Pastille ton="eteint">Indésirable</Pastille> : null}
          {verdict.manipulation ? <Pastille ton="revue">Manipulation</Pastille> : null}
        </p>
      ) : null}
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
        leur propager, ou redispatchez le Retour pour l’envoyer aux Destinations qui le retiennent
        désormais.
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
    <ul className="liste envois">
      {envois.map((envoi) => (
        <li key={envoi.id}>
          <div className="envoi">
            <div className="envoi-destination">
              <strong>{envoi.destination.nom}</strong>
              <span className="discret">
                {envoi.destination.type}
                {envoi.destination.etat !== 'active' ? (
                  <>
                    {' '}
                    <PastilleEtatDestination etat={envoi.destination.etat} />
                  </>
                ) : null}
              </span>
            </div>
            <PastilleStatutEnvoi statut={envoi.statut} />
            <span className="discret envoi-tentatives">
              {envoi.tentatives} tentative{envoi.tentatives > 1 ? 's' : ''}
            </span>
            {estEnvoiRejouable(envoi.statut) ? (
              <button
                type="button"
                className="secondaire"
                disabled={rejeu.isPending}
                onClick={() => rejeu.mutate(envoi.id, { onSuccess: apresRejeu })}
              >
                Rejouer
              </button>
            ) : (
              <span />
            )}
          </div>
          {envoi.lienExterne ? (
            <p className="envoi-lien">
              <LienExterne href={envoi.lienExterne} />
            </p>
          ) : null}
          {envoi.derniereErreur ? <p className="alerte">{envoi.derniereErreur}</p> : null}
          {rejeu.variables === envoi.id ? <ErrorMessage erreur={rejeu.error} /> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Redispatcher le Retour selon son Verdict courant, après une correction ou l'ajout
 * d'une Destination : crée les Envois manquants vers les Destinations dont le Filtre le
 * retient désormais. Les Envois existants ne sont pas touchés.
 */
function Redispatch({
  retourId,
  apresRedispatch,
}: {
  retourId: string;
  apresRedispatch: () => void;
}) {
  const redispatch = useRedispatch(retourId);
  const crees = redispatch.data?.envoisCrees;
  return (
    <>
      <p className="aide">
        Redispatcher envoie le Retour, selon son Verdict actuel, aux Destinations dont le Filtre le
        retient et qui ne l’ont pas encore reçu. Les Envois existants ne sont pas touchés.
      </p>
      <div className="actions">
        <button
          type="button"
          className="secondaire"
          disabled={redispatch.isPending}
          onClick={() => redispatch.mutate(undefined, { onSuccess: apresRedispatch })}
        >
          Redispatcher
        </button>
      </div>
      {crees === undefined ? null : (
        <p role="status">
          {crees === 0
            ? 'Aucune autre Destination ne retient ce Retour.'
            : `${crees} Envoi${crees > 1 ? 's' : ''} créé${crees > 1 ? 's' : ''}.`}
        </p>
      )}
      <ErrorMessage erreur={redispatch.error} />
    </>
  );
}
