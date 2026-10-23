import type { AuteurVu, Contexte, EnvoiVu, VerdictVu } from '@nudge/shared';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useRetour } from '../api/retours.js';
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
import { ErrorMessage, LienExterne, Loading } from '../layout/ui.js';
import { BadgeIncertain } from './retour-badges.js';

/**
 * Détail d'un Retour. Tout ce que l'Auteur a fourni (texte, identité, contexte)
 * est rendu comme du texte : jamais de HTML, jamais de lien hors http(s).
 * Les actions de revue, la Capture et la suppression s'ajoutent comme sections.
 */
export function Retour() {
  const id = useParams().id ?? '';
  const retour = useRetour(id);
  if (retour.isPending) return <Loading />;
  if (retour.isError) return <ErrorMessage erreur={retour.error} />;
  const r = retour.data;
  return (
    <article className="retour">
      <p className="discret">
        <Link to="/retours">Boîte de réception</Link>
      </p>
      <h1>Retour</h1>
      <p className="meta">
        <Link to={`/projets/${r.projet.id}`}>{r.projet.nom}</Link>
        <span>{LIBELLES_ETAT[r.etat]}</span>
        <span>{LIBELLES_SOURCE[r.source]}</span>
        <time dateTime={r.createdAt}>{formatDate(r.createdAt)}</time>
      </p>
      <p className="texte-retour" aria-label="Texte du Retour">
        {r.texte}
      </p>
      {r.typeDeclare ? (
        <p className="discret">Type déclaré par l’Auteur : {LIBELLES_TYPE[r.typeDeclare]}</p>
      ) : null}
      <Section id="verdict" titre="Verdict">
        <Verdict verdict={r.verdict} />
      </Section>
      <Section id="auteur" titre="Auteur">
        <Auteur auteur={r.auteur} />
      </Section>
      <Section id="contexte" titre="Contexte">
        <ContexteRetour contexte={r.contexte} />
      </Section>
      <Section id="envois" titre="Envois">
        <Envois envois={r.envois} />
      </Section>
    </article>
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

function Verdict({ verdict }: { verdict: VerdictVu | null }) {
  if (!verdict) return <p className="discret">Ce Retour n’est pas encore trié.</p>;
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
    </>
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

function Envois({ envois }: { envois: readonly EnvoiVu[] }) {
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
        </li>
      ))}
    </ul>
  );
}
