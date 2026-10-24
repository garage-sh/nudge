import { randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { envoiDEssai, type DestinationAdapterResolver, type SecretCipher } from '@nudge/core';
import {
  chiffrerSecretsDestination,
  createDestination,
  dechiffrerSecretsDestination,
  destinations,
  filtreDe,
  projets,
  toDestinationConfiguree,
  type Db,
  type DestinationRow,
  type SecretsDestination,
} from '@nudge/database';
import {
  DEFINITIONS_DESTINATION,
  estTypeDestination,
  FILTRE_TOUT,
  type ApiErrorBody,
  type DefinitionDestination,
  type DestinationAvecSecretsGeneres,
  type DestinationVu,
  type ResultatTestDestination,
  type schemaModificationDestination,
  type schemaNouvelleDestination,
  type TypeDestination,
} from '@nudge/shared';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DB, DESTINATION_ADAPTER_RESOLVER, SECRET_CIPHER } from '../../infra/tokens.js';
import { isUuid, parseBody } from '../../validation.js';

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
  ) {}

  async lister(projetId: string): Promise<DestinationVu[]> {
    await this.projet(projetId);
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
    await this.projet(projetId);
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
   * (`null` efface). Les secrets générés par l'Instance ne se modifient pas ici.
   */
  async modifier(id: string, champs: ModificationDestination): Promise<DestinationVu> {
    const ligne = await this.ligne(id);
    const definition = definitionDe(ligne.type);
    const actuels = dechiffrerSecretsDestination(this.cipher, ligne);
    const generes = garder(actuels, (nom) => definition.secretsGeneres.includes(nom));
    const saisis: Record<string, string> = garder(
      actuels,
      (nom) => !definition.secretsGeneres.includes(nom),
    );
    for (const [nom, valeur] of Object.entries(champs.secrets ?? {})) {
      if (valeur === null) delete saisis[nom];
      else saisis[nom] = valeur;
    }
    const { config, secrets } = validerParType(definition, {
      config: champs.config ?? ligne.config,
      secrets: saisis,
    });
    const [modifiee] = await this.db
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
        secretsChiffres: chiffrerSecretsDestination(this.cipher, id, { ...secrets, ...generes }),
        updatedAt: new Date(),
      })
      .where(eq(destinations.id, id))
      .returning();
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

  /** Nouveaux secrets générés (secret de signature…), lisibles cette seule fois. */
  async regenererSecretsGeneres(id: string): Promise<DestinationAvecSecretsGeneres> {
    const ligne = await this.ligne(id);
    const secretsGeneres = genererSecrets(definitionDe(ligne.type));
    const secrets = { ...dechiffrerSecretsDestination(this.cipher, ligne), ...secretsGeneres };
    const [modifiee] = await this.db
      .update(destinations)
      .set({
        secretsChiffres: chiffrerSecretsDestination(this.cipher, id, secrets),
        updatedAt: new Date(),
      })
      .where(eq(destinations.id, id))
      .returning();
    if (!modifiee) throw destinationIntrouvable();
    return { destination: this.vu(modifiee), secretsGeneres };
  }

  /**
   * Bouton « tester » : un Retour d'exemple passe par l'adaptateur, sans Envoi en base
   * ni effet sur la Suspension. Une exception de l'adaptateur est un échec transitoire.
   */
  async tester(id: string): Promise<ResultatTestDestination> {
    const ligne = await this.ligne(id);
    const projet = await this.projet(ligne.projetId);
    try {
      const adaptateur = this.resolveDestinationAdapter(
        toDestinationConfiguree(ligne, this.cipher),
      );
      return await adaptateur.send(envoiDEssai({ id: projet.id, nom: projet.nom }));
    } catch (erreur) {
      return {
        statut: 'echec',
        classe: 'transient',
        message: erreur instanceof Error ? erreur.message : String(erreur),
      };
    }
  }

  private vu(ligne: DestinationRow): DestinationVu {
    return {
      id: ligne.id,
      projetId: ligne.projetId,
      nom: ligne.nom,
      type: ligne.type as TypeDestination,
      config: ligne.config,
      filtre: filtreDe(ligne),
      etat: ligne.etat,
      secrets: Object.keys(dechiffrerSecretsDestination(this.cipher, ligne)).sort(),
      createdAt: ligne.createdAt.toISOString(),
    };
  }

  private async ligne(id: string): Promise<DestinationRow> {
    if (!isUuid(id)) throw destinationIntrouvable();
    const [ligne] = await this.db.select().from(destinations).where(eq(destinations.id, id));
    if (!ligne) throw destinationIntrouvable();
    return ligne;
  }

  private async projet(id: string): Promise<{ id: string; nom: string }> {
    const projetIntrouvable = new NotFoundException({ erreur: 'projet_introuvable' });
    if (!isUuid(id)) throw projetIntrouvable;
    const [projet] = await this.db
      .select({ id: projets.id, nom: projets.nom })
      .from(projets)
      .where(eq(projets.id, id));
    if (!projet) throw projetIntrouvable;
    return projet;
  }
}

const destinationIntrouvable = () => new NotFoundException({ erreur: 'destination_introuvable' });

/** Une Destination dont le type n'est plus servi par cette Instance ne se modifie pas. */
function definitionDe(type: string): DefinitionDestination {
  if (estTypeDestination(type)) return DEFINITIONS_DESTINATION[type];
  const refus: ApiErrorBody = { erreur: 'type_destination_inconnu' };
  throw new BadRequestException(refus);
}

/** Config et secrets selon le schéma du type ; un refus nomme `config.…` ou `secrets.…`. */
function validerParType(
  definition: DefinitionDestination,
  valeurs: { config: unknown; secrets: unknown },
): { config: Record<string, unknown>; secrets: SecretsDestination } {
  return parseBody(
    z.strictObject({ config: definition.config, secrets: definition.secrets }),
    valeurs,
  );
}

function genererSecrets(definition: DefinitionDestination): Record<string, string> {
  return Object.fromEntries(
    definition.secretsGeneres.map((nom) => [nom, randomBytes(32).toString('base64url')]),
  );
}

function garder(
  secrets: SecretsDestination,
  predicat: (nom: string) => boolean,
): Record<string, string> {
  return Object.fromEntries(Object.entries(secrets).filter(([nom]) => predicat(nom)));
}
