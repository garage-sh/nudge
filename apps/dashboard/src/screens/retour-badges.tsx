import {
  GRAVITES,
  type EtatDestination,
  type EtatRetour,
  type Gravite,
  type StatutEnvoi,
} from '@nudge/shared';
import { Pastille, type Ton } from '../layout/ui.js';
import {
  LIBELLES_ETAT,
  LIBELLES_ETAT_DESTINATION,
  LIBELLES_GRAVITE,
  LIBELLES_STATUT_ENVOI,
} from '../libelles.js';

/** Marqueur d'un Verdict sur lequel le Juge a hésité : un Membre devrait le vérifier. */
export function BadgeIncertain() {
  return (
    <Pastille ton="revue" title="Le Juge a hésité : à vérifier">
      Incertain
    </Pastille>
  );
}

/**
 * La Gravité en jauge de quatre barres : autant de barres pleines que le niveau, en
 * pointillés quand le Retour n'a pas de Gravité. Lisible sans la couleur ; le niveau
 * est aussi écrit pour les lecteurs d'écran (`visible` l'affiche à côté).
 */
export function JaugeGravite({
  gravite,
  grande = false,
  visible = false,
  libelle: libelleVisible,
}: {
  gravite: Gravite | null | undefined;
  grande?: boolean;
  visible?: boolean;
  /** Le texte affiché à côté de la jauge, à la place du nom de la Gravité. */
  libelle?: string;
}) {
  const niveau = gravite ? GRAVITES.indexOf(gravite) + 1 : 0;
  const libelle = libelleVisible ?? (gravite ? LIBELLES_GRAVITE[gravite] : 'Sans Gravité');
  return (
    <span className="porte-jauge">
      <span className={grande ? 'jauge grande' : 'jauge'} data-niveau={niveau} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      {visible || libelleVisible ? (
        <span>{libelle}</span>
      ) : (
        <span className="visuellement-cache">{gravite ? `Gravité ${libelle}` : libelle}</span>
      )}
    </span>
  );
}

const TONS_ETAT: Record<EtatRetour, Ton> = {
  recu: 'neutre',
  trie: 'neutre',
  dispatche: 'succes',
  en_revue: 'revue',
  ecarte: 'eteint',
};

export function PastilleEtat({ etat }: { etat: EtatRetour }) {
  return <Pastille ton={TONS_ETAT[etat]}>{LIBELLES_ETAT[etat]}</Pastille>;
}

const TONS_STATUT_ENVOI: Record<StatutEnvoi, Ton> = {
  en_attente: 'neutre',
  livre: 'succes',
  echec: 'danger',
  retenu: 'retenu',
};

export function PastilleStatutEnvoi({ statut }: { statut: StatutEnvoi }) {
  return <Pastille ton={TONS_STATUT_ENVOI[statut]}>{LIBELLES_STATUT_ENVOI[statut]}</Pastille>;
}

export function PastilleEtatDestination({ etat }: { etat: EtatDestination }) {
  return (
    <Pastille ton={etat === 'active' ? 'succes' : 'retenu'}>
      {LIBELLES_ETAT_DESTINATION[etat]}
    </Pastille>
  );
}
