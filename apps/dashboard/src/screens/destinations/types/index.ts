import { isDestinationType, type DestinationType } from '@nudge/shared';
import { discordForm } from './discord.js';
import { emailForm } from './email.js';
import { gitHubForm } from './github.js';
import { linearForm } from './linear.js';
import { slackForm } from './slack.js';
import type { DestinationTypeForm } from './destination-type-form.js';
import { webhookForm } from './webhook.js';

export type { TypeFieldsProps, DestinationTypeForm } from './destination-type-form.js';
export { TypeIcon } from './type-icon.js';

/** One form per type of `DESTINATION_DEFINITIONS`: the compiler requires each entry. */
export const DESTINATION_FORMS: {
  readonly [T in DestinationType]: DestinationTypeForm<T>;
} = {
  webhook: webhookForm,
  discord: discordForm,
  linear: linearForm,
  slack: slackForm,
  github: gitHubForm,
  email: emailForm,
};

/** The form of any one of the types. */
export type AnyDestinationTypeForm = (typeof DESTINATION_FORMS)[DestinationType];

/** A type's form, or `null` for a type this dashboard does not know. */
export const formOf = (type: string): AnyDestinationTypeForm | null =>
  isDestinationType(type) ? DESTINATION_FORMS[type] : null;
