import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  testAlert,
  sendAlert,
  type DestinationAdapterResolver,
  type SecretCipher,
} from '@nudge/core';
import {
  encryptAlertDestinationSecrets,
  decryptAlertDestinationSecrets,
  configuredAlertDestination,
  readAlertDestination,
  writeAlertDestination,
  type Db,
  type StoredAlertDestination,
} from '@nudge/database';
import {
  DESTINATION_DEFINITIONS,
  type AlertDestinationWithGeneratedSecrets,
  type AlertDestinationView,
  type DestinationTestResult,
  type alertDestinationSchema,
} from '@nudge/shared';
import type { z } from 'zod';
import { DB, DESTINATION_ADAPTER_RESOLVER, SECRET_CIPHER } from '../../infra/tokens.js';
import {
  applyEnteredSecrets,
  generateSecrets,
  readableSecrets,
  splitSecrets,
  validateByType,
} from '../destinations/by-type.js';

type AlertDestinationInput = z.output<typeof alertDestinationSchema>;

/**
 * The Instance's Alert destination (D6): a Destination type served by its adapter, with
 * its config and its encrypted secrets, in `instance_settings`.
 */
@Injectable()
export class AlertDestinationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
  ) {}

  async read(): Promise<AlertDestinationView | null> {
    const destination = await readAlertDestination(this.db);
    return destination ? this.view(destination) : null;
  }

  /**
   * For the same type, the entered secrets replace or clear (`null`) the stored ones,
   * and the generated secrets are kept. Another type starts over: its generated secrets
   * are drawn and returned this one time.
   */
  async configure(input: AlertDestinationInput): Promise<AlertDestinationWithGeneratedSecrets> {
    const definition = DESTINATION_DEFINITIONS[input.type];
    const current = await readAlertDestination(this.db);
    const sameType = current?.type === input.type;
    const { generated, entered } = sameType
      ? splitSecrets(definition, this.readableSecrets(current))
      : { generated: {}, entered: {} };
    const { config, secrets } = validateByType(definition, {
      config: input.config,
      secrets: applyEnteredSecrets(entered, input.secrets),
    });
    // A missing generated secret (new type, secrets that became undecryptable) is drawn.
    const missing = generateSecrets({
      ...definition,
      generatedSecrets: definition.generatedSecrets.filter((name) => !(name in generated)),
    });
    const stored: StoredAlertDestination = {
      type: input.type,
      config,
      encryptedSecrets: encryptAlertDestinationSecrets(this.cipher, {
        ...secrets,
        ...generated,
        ...missing,
      }),
    };
    await writeAlertDestination(this.db, stored);
    return { destination: this.view(stored), generatedSecrets: missing };
  }

  async remove(): Promise<void> {
    await writeAlertDestination(this.db, null);
  }

  /** "Test" button: a sample alert goes through the adapter. */
  async test(): Promise<DestinationTestResult> {
    const destination = await readAlertDestination(this.db);
    if (!destination) throw new NotFoundException({ error: 'alert_destination_missing' });
    return sendAlert(
      () => this.resolveDestinationAdapter(configuredAlertDestination(destination, this.cipher)),
      testAlert(),
    );
  }

  private view(destination: StoredAlertDestination): AlertDestinationView {
    return {
      type: destination.type,
      config: destination.config,
      secrets: Object.keys(this.readableSecrets(destination)).sort(),
    };
  }

  private readableSecrets(destination: StoredAlertDestination): Record<string, string> {
    return readableSecrets(() => decryptAlertDestinationSecrets(this.cipher, destination));
  }
}
