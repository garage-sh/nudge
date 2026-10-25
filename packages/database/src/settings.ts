import type { ConfiguredDestination, SecretCipher } from '@nudge/core';
import type { JudgeProvider } from '@nudge/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import type { DestinationSecrets } from './destinations.js';
import { instanceSettings } from './schema.js';

/** Encryption context of the Judge's key: it decrypts only for this use. */
export const JUDGE_KEY_CONTEXT = 'instance_settings.judge_key';

const SETTINGS_ROW_ID = 1;

/** The Judge as stored for the Instance, key still encrypted. */
export interface StoredJudge {
  readonly provider: JudgeProvider | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly encryptedKey: string | null;
}

/** No Judge chosen: the Instance falls back on the environment, otherwise degraded mode. */
export const NO_JUDGE: StoredJudge = {
  provider: null,
  model: null,
  baseUrl: null,
  encryptedKey: null,
};

export async function readInstanceJudge(db: Db): Promise<StoredJudge> {
  const [row] = await db
    .select({
      provider: instanceSettings.judgeProvider,
      model: instanceSettings.judgeModel,
      baseUrl: instanceSettings.judgeBaseUrl,
      encryptedKey: instanceSettings.judgeEncryptedKey,
    })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, SETTINGS_ROW_ID));
  return row ?? NO_JUDGE;
}

/** Creates the Instance settings row on the first save. */
export async function writeInstanceJudge(db: Db, judge: StoredJudge): Promise<void> {
  const values = {
    judgeProvider: judge.provider,
    judgeModel: judge.model,
    judgeBaseUrl: judge.baseUrl,
    judgeEncryptedKey: judge.encryptedKey,
  };
  await db
    .insert(instanceSettings)
    .values({ id: SETTINGS_ROW_ID, ...values })
    .onConflictDoUpdate({ target: instanceSettings.id, set: values });
}

/** Encryption context of the Alert destination's secrets. */
export const ALERT_DESTINATION_SECRETS_CONTEXT = 'instance_settings.alert_destination_secrets';

/**
 * Identifier of the Alert destination for the adapters (messages, caches): it is unique
 * to the Instance and has no row in `destinations`.
 */
export const ALERT_DESTINATION_ID = 'instance-alert-destination';

/** The Alert destination as stored, secrets still encrypted. */
export interface StoredAlertDestination {
  readonly type: string;
  readonly config: Record<string, unknown>;
  readonly encryptedSecrets: string | null;
}

/** `null`: the Instance has no Alert destination. */
export async function readAlertDestination(db: Db): Promise<StoredAlertDestination | null> {
  const [row] = await db
    .select({
      type: instanceSettings.alertDestinationType,
      config: instanceSettings.alertDestinationConfig,
      encryptedSecrets: instanceSettings.alertDestinationEncryptedSecrets,
    })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, SETTINGS_ROW_ID));
  if (!row?.type) return null;
  return { type: row.type, config: row.config ?? {}, encryptedSecrets: row.encryptedSecrets };
}

/** Saves (or removes, `null`) the Alert destination; creates the row if needed. */
export async function writeAlertDestination(
  db: Db,
  alert: StoredAlertDestination | null,
): Promise<void> {
  const values = {
    alertDestinationType: alert?.type ?? null,
    alertDestinationConfig: alert?.config ?? null,
    alertDestinationEncryptedSecrets: alert?.encryptedSecrets ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(instanceSettings)
    .values({ id: SETTINGS_ROW_ID, ...values })
    .onConflictDoUpdate({ target: instanceSettings.id, set: values });
}

/** `null` when there is no secret to keep. */
export function encryptAlertDestinationSecrets(
  cipher: SecretCipher,
  secrets: DestinationSecrets,
): string | null {
  if (Object.keys(secrets).length === 0) return null;
  return cipher.encrypt(JSON.stringify(secrets), ALERT_DESTINATION_SECRETS_CONTEXT);
}

/** Throws `SecretDecryptionError` if the secrets no longer decrypt (Instance key changed). */
export function decryptAlertDestinationSecrets(
  cipher: SecretCipher,
  alert: Pick<StoredAlertDestination, 'encryptedSecrets'>,
): DestinationSecrets {
  if (!alert.encryptedSecrets) return {};
  return JSON.parse(
    cipher.decrypt(alert.encryptedSecrets, ALERT_DESTINATION_SECRETS_CONTEXT),
  ) as DestinationSecrets;
}

/** The Alert destination, secrets decrypted, as a `DestinationAdapterResolver` receives it. */
export function configuredAlertDestination(
  alert: StoredAlertDestination,
  cipher: SecretCipher,
): ConfiguredDestination {
  return {
    id: ALERT_DESTINATION_ID,
    projectId: null,
    name: 'Alert destination',
    type: alert.type,
    config: alert.config,
    secrets: decryptAlertDestinationSecrets(cipher, alert),
  };
}

/** Retention period of Feedback in days; `null`: unlimited (also without settings). */
export async function readInstanceRetention(db: Db): Promise<number | null> {
  const [row] = await db
    .select({ days: instanceSettings.retentionDays })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, SETTINGS_ROW_ID));
  return row?.days ?? null;
}

/** Saves the retention period (`null`: unlimited); creates the row if needed. */
export async function writeInstanceRetention(db: Db, days: number | null): Promise<void> {
  const values = { retentionDays: days, updatedAt: new Date() };
  await db
    .insert(instanceSettings)
    .values({ id: SETTINGS_ROW_ID, ...values })
    .onConflictDoUpdate({ target: instanceSettings.id, set: values });
}
