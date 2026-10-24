import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  alerteDEssai,
  alerter,
  SecretDecryptionError,
  type DestinationAdapterResolver,
  type SecretCipher,
} from '@nudge/core';
import {
  chiffrerSecretsAlerte,
  dechiffrerSecretsAlerte,
  destinationAlerteConfiguree,
  readDestinationAlerte,
  writeDestinationAlerte,
  type Db,
  type DestinationAlerteEnregistree,
} from '@nudge/database';
import {
  DEFINITIONS_DESTINATION,
  type DestinationAlerteAvecSecretsGeneres,
  type DestinationAlerteVu,
  type ResultatTestDestination,
  type schemaDestinationAlerte,
} from '@nudge/shared';
import type { z } from 'zod';
import { DB, DESTINATION_ADAPTER_RESOLVER, SECRET_CIPHER } from '../../infra/tokens.js';
import {
  appliquerSecretsSaisis,
  genererSecrets,
  separerSecrets,
  validerParType,
} from '../destinations/par-type.js';

type DestinationAlerteSaisie = z.output<typeof schemaDestinationAlerte>;

/**
 * La Destination d'alerte de l'Instance (D6) : un type de Destination servi par son
 * adaptateur, avec sa config et ses secrets chiffrés, dans `parametres_instance`.
 */
@Injectable()
export class DestinationAlerteService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
  ) {}

  async lire(): Promise<DestinationAlerteVu | null> {
    const alerte = await readDestinationAlerte(this.db);
    return alerte ? this.vu(alerte) : null;
  }

  /**
   * Pour le même type, les secrets saisis remplacent ou effacent (`null`) ceux
   * enregistrés, et les secrets générés sont gardés. Un autre type repart de zéro :
   * ses secrets générés sont tirés et rendus cette seule fois.
   */
  async configurer(saisie: DestinationAlerteSaisie): Promise<DestinationAlerteAvecSecretsGeneres> {
    const definition = DEFINITIONS_DESTINATION[saisie.type];
    const actuelle = await readDestinationAlerte(this.db);
    const memeType = actuelle?.type === saisie.type;
    const { generes, saisis } = memeType
      ? separerSecrets(definition, this.secretsLisibles(actuelle))
      : { generes: {}, saisis: {} };
    const { config, secrets } = validerParType(definition, {
      config: saisie.config,
      secrets: appliquerSecretsSaisis(saisis, saisie.secrets),
    });
    // Un secret généré manquant (type nouveau, secrets devenus indéchiffrables) est tiré.
    const manquants = genererSecrets({
      ...definition,
      secretsGeneres: definition.secretsGeneres.filter((nom) => !(nom in generes)),
    });
    const enregistree: DestinationAlerteEnregistree = {
      type: saisie.type,
      config,
      secretsChiffres: chiffrerSecretsAlerte(this.cipher, { ...secrets, ...generes, ...manquants }),
    };
    await writeDestinationAlerte(this.db, enregistree);
    return { destination: this.vu(enregistree), secretsGeneres: manquants };
  }

  async retirer(): Promise<void> {
    await writeDestinationAlerte(this.db, null);
  }

  /** Bouton « tester » : une alerte d'exemple passe par l'adaptateur. */
  async tester(): Promise<ResultatTestDestination> {
    const alerte = await readDestinationAlerte(this.db);
    if (!alerte) throw new NotFoundException({ erreur: 'destination_alerte_absente' });
    return alerter(
      () => this.resolveDestinationAdapter(destinationAlerteConfiguree(alerte, this.cipher)),
      alerteDEssai(),
    );
  }

  private vu(alerte: DestinationAlerteEnregistree): DestinationAlerteVu {
    return {
      type: alerte.type,
      config: alerte.config,
      secrets: Object.keys(this.secretsLisibles(alerte)).sort(),
    };
  }

  /** Des secrets indéchiffrables (clé d'Instance changée) valent « aucun secret ». */
  private secretsLisibles(alerte: DestinationAlerteEnregistree): Record<string, string> {
    try {
      return { ...dechiffrerSecretsAlerte(this.cipher, alerte) };
    } catch (erreur) {
      if (erreur instanceof SecretDecryptionError) return {};
      throw erreur;
    }
  }
}
