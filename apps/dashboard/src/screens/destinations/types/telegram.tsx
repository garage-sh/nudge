import { useT } from '../../../i18n/index.js';
import { Field } from '../../../layout/ui.js';
import type { DestinationTypeForm, TypeFieldsProps } from './destination-type-form.js';
import { TYPE_ICONS } from './type-icon.js';

const chatId = (config: Readonly<Record<string, unknown>>) =>
  typeof config.chatId === 'string' ? config.chatId : '';

const topicId = (config: Readonly<Record<string, unknown>>) =>
  typeof config.topicId === 'number' ? config.topicId : null;

/**
 * Telegram: the bot token is a secret, typed in and never shown again; the chat and its
 * optional forum topic are configuration.
 */
function TelegramFields({
  idPrefix,
  config,
  setConfig,
  secrets,
  setSecrets,
  savedSecrets,
}: TypeFieldsProps) {
  const t = useT();
  const kept = savedSecrets.includes('botToken');
  const topic = topicId(config);
  return (
    <>
      <Field
        label={t.destinationTypes.telegram.botToken}
        id={`${idPrefix}-telegram-token`}
        type="password"
        autoComplete="off"
        required={!kept}
        placeholder="123456789:AA…"
        value={secrets.botToken ?? ''}
        onChange={(e) => setSecrets({ ...secrets, botToken: e.target.value })}
        help={kept ? t.destinationTypes.savedToken : t.destinationTypes.telegram.botTokenHelp}
      />
      <Field
        label={t.destinationTypes.telegram.chatId}
        id={`${idPrefix}-telegram-chat`}
        required
        placeholder="-1001234567890"
        value={chatId(config)}
        onChange={(e) => setConfig({ ...config, chatId: e.target.value })}
        help={t.destinationTypes.telegram.chatIdHelp}
      />
      <Field
        label={t.destinationTypes.telegram.topicId}
        id={`${idPrefix}-telegram-topic`}
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        value={topic === null ? '' : String(topic)}
        onChange={(e) =>
          setConfig({
            ...config,
            topicId: e.target.value === '' ? null : Number(e.target.value),
          })
        }
        help={t.destinationTypes.telegram.topicIdHelp}
      />
    </>
  );
}

export const telegramForm: DestinationTypeForm<'telegram'> = {
  label: 'Telegram',
  icon: TYPE_ICONS.telegram,
  initialConfig: { chatId: '', topicId: null },
  Fields: TelegramFields,
  summary: (config, t) => t.destinationTypes.telegram.summary(chatId(config), topicId(config)),
  generatedSecrets: {},
};
