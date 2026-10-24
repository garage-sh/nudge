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
 * pointillés quand le Retour n'a pas de Gravité. Lisible sans la couleur.
 */
export function JaugeGravite({
  gravite,
  grande = false,
}: {
  gravite: Gravite | null | undefined;
  grande?: boolean;
}) {
  const niveau = gravite ? GRAVITES.indexOf(gravite) + 1 : 0;
  return (
    <span
      className={grande ? 'jauge grande' : 'jauge'}
      data-niveau={niveau}
      role="img"
      aria-label={gravite ? `Gravité ${LIBELLES_GRAVITE[gravite].toLowerCase()}` : 'Sans Gravité'}
    >
      <span />
      <span />
      <span />
      <span />
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
