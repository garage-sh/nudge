import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  envoiDEssai,
  envoyer,
  SecretDecryptionError,
  type DestinationAdapterResolver,
  type SecretCipher,
} from '@nudge/core';
import {
  chiffrerSecretsDestination,
  createDestination,
  dechiffrerSecretsDestination,
  destinations,
  filtreDe,
  toDestinationConfiguree,
  type Db,
  type DestinationRow,
} from '@nudge/database';
import {
  DEFINITIONS_DESTINATION,
  FILTRE_TOUT,
  type DestinationAvecSecretsGeneres,
  type DestinationVu,
  type ResultatTestDestination,
  type schemaModificationDestination,
  type schemaNouvelleDestination,
} from '@nudge/shared';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { DB, DESTINATION_ADAPTER_RESOLVER, SECRET_CIPHER } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';
import { ProjetsService } from '../projets/projets.service.js';
import {
  appliquerSecretsSaisis,
  definitionDe,
  genererSecrets,
  separerSecrets,
  validerParType,
} from './par-type.js';

type NouvelleDestination = z.output<typeof schemaNouvelleDestination>;
type ModificationDestination = z.output<typeof schemaModificationDestination>;

/**
 * Destinations des Projets. Rien ici ne dépend d'un type en particulier : la config
 * et les secrets sont validés par la définition du type (`DEFINITIONS_DESTINATION`),
 * l'envoi d'essai passe par son adaptateur.
 */
@Injectable()
export class DestinationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
    private readonly projets: ProjetsService,
  ) {}

  async lister(projetId: string): Promise<DestinationVu[]> {
    await this.projets.read(projetId);
    const lignes = await this.db
      .select()
      .from(destinations)
      .where(eq(destinations.projetId, projetId))
      .orderBy(asc(destinations.createdAt), asc(destinations.id));
    return lignes.map((ligne) => this.vu(ligne));
  }

  async creer(
    projetId: string,
    nouvelle: NouvelleDestination,
  ): Promise<DestinationAvecSecretsGeneres> {
    await this.projets.read(projetId);
    const definition = DEFINITIONS_DESTINATION[nouvelle.type];
    const { config, secrets } = validerParType(definition, {
      config: nouvelle.config,
      secrets: nouvelle.secrets ?? {},
    });
    const secretsGeneres = genererSecrets(definition);
    const ligne = await createDestination(this.db, this.cipher, {
      projetId,
      nom: nouvelle.nom,
      type: nouvelle.type,
      config,
      secrets: { ...secrets, ...secretsGeneres },
      filtre: nouvelle.filtre ?? FILTRE_TOUT,
    });
    return { destination: this.vu(ligne), secretsGeneres };
  }

  async lire(id: string): Promise<DestinationVu> {
    return this.vu(await this.ligne(id));
  }

  /**
   * `config` remplace la configuration ; `secrets` ne touche que les secrets nommés
   * (`null` efface). Les secrets générés par l'Instance ne se modifient pas ici. La
   * ligne est verrouillée le temps de fusionner ses secrets : une régénération
   * concurrente n'est pas écrasée.
   */
  async modifier(id: string, champs: ModificationDestination): Promise<DestinationVu> {
    if (!isUuid(id)) throw destinationIntrouvable();
    const modifiee = await this.db.transaction(async (tx) => {
      const [ligne] = await tx
        .select()
        .from(destinations)
        .where(eq(destinations.id, id))
        .for('update');
      if (!ligne) throw destinationIntrouvable();
      const definition = definitionDe(ligne.type);
      const { generes, saisis } = separerSecrets(definition, this.secretsLisibles(ligne));
      const { config, secrets } = validerParType(definition, {
        config: champs.config ?? ligne.config,
        secrets: appliquerSecretsSaisis(saisis, champs.secrets),
      });
      const [resultat] = await tx
        .update(destinations)
        .set({
          ...(champs.nom ? { nom: champs.nom } : {}),
          ...(champs.filtre
            ? {
                filtreTypes: [...champs.filtre.types],
                filtreGraviteMinimale: champs.filtre.graviteMinimale,
              }
            : {}),
          config,
          secretsChiffres: chiffrerSecretsDestination(this.cipher, id, {
            ...secrets,
            ...generes,
          }),
          updatedAt: new Date(),
        })
        .where(eq(destinations.id, id))
        .returning();
      return resultat;
    });
    if (!modifiee) throw destinationIntrouvable();
    return this.vu(modifiee);
  }

  /** Ses Envois disparaissent avec elle. */
  async supprimer(id: string): Promise<void> {
    if (!isUuid(id)) throw destinationIntrouvable();
    const supprimees = await this.db
      .delete(destinations)
      .where(eq(destinations.id, id))
      .returning({ id: destinations.id });
    if (supprimees.length === 0) throw destinationIntrouvable();
  }

  /**
   * Nouveaux secrets générés (secret de signature…), lisibles cette seule fois. Ligne
   * verrouillée comme pour une modification ; des secrets devenus indéchiffrables
   * (clé d'Instance changée) sont remplacés par les nouveaux.
   */
  async regenererSecretsGeneres(id: string): Promise<DestinationAvecSecretsGeneres> {
    if (!isUuid(id)) throw destinationIntrouvable();
    return this.db.transaction(async (tx) => {
      const [ligne] = await tx
        .select()
        .from(destinations)
        .where(eq(destinations.id, id))
        .for('update');
      if (!ligne) throw destinationIntrouvable();
      const secretsGeneres = genererSecrets(definitionDe(ligne.type));
      const secrets = { ...this.secretsLisibles(ligne), ...secretsGeneres };
      const [modifiee] = await tx
        .update(destinations)
        .set({
          secretsChiffres: chiffrerSecretsDestination(this.cipher, id, secrets),
          updatedAt: new Date(),
        })
        .where(eq(destinations.id, id))
        .returning();
      if (!modifiee) throw destinationIntrouvable();
      return { destination: this.vu(modifiee), secretsGeneres };
    });
  }

  /**
   * Bouton « tester » : un Retour d'exemple passe par l'adaptateur, sans Envoi en base
   * ni effet sur la Suspension. Une exception de l'adaptateur est un échec transitoire.
   */
  async tester(id: string): Promise<ResultatTestDestination> {
    const ligne = await this.ligne(id);
    const projet = await this.projets.read(ligne.projetId);
    return envoyer(
      () => this.resolveDestinationAdapter(toDestinationConfiguree(ligne, this.cipher)),
      envoiDEssai({ id: projet.id, nom: projet.nom }),
    );
  }

  private vu(ligne: DestinationRow): DestinationVu {
    return {
      id: ligne.id,
      projetId: ligne.projetId,
      nom: ligne.nom,
      type: ligne.type,
      config: ligne.config,
      filtre: filtreDe(ligne),
      etat: ligne.etat,
      secrets: Object.keys(this.secretsLisibles(ligne)).sort(),
      createdAt: ligne.createdAt.toISOString(),
    };
  }

  /**
   * Des secrets indéchiffrables (clé d'Instance changée) valent « aucun secret » : la
   * Destination reste listée et modifiable, le Membre ressaisit ou régénère ses secrets.
   */
  private secretsLisibles(ligne: DestinationRow): Record<string, string> {
    try {
      return { ...dechiffrerSecretsDestination(this.cipher, ligne) };
    } catch (erreur) {
      if (erreur instanceof SecretDecryptionError) return {};
      throw erreur;
    }
  }

  private async ligne(id: string): Promise<DestinationRow> {
    if (!isUuid(id)) throw destinationIntrouvable();
    const [ligne] = await this.db.select().from(destinations).where(eq(destinations.id, id));
    if (!ligne) throw destinationIntrouvable();
    return ligne;
  }
}

const destinationIntrouvable = () => new NotFoundException({ erreur: 'destination_introuvable' });
