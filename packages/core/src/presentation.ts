/**
 * A message put into words once, shared by the adapters that write one: a Member alert
 * (`presentAlert`), an Incident Delivery (`presentIncident`), a summary of Held
 * Incidents (`presentHeldSummary`). Each adapter only encodes it for its target.
 */
export interface PresentedMessage {
  /** Short title, in plain text (the name of the Project or the Destination is in it). */
  readonly title: string;
  /** What happened, in plain text; what is expected of the Member, for an alert. */
  readonly summary: string;
  /**
   * Details in plain text, to be encoded by each adapter for its target; `long`: a text
   * that deserves the full width (the target's refusal).
   */
  readonly details: readonly {
    readonly label: string;
    readonly value: string;
    readonly long?: boolean;
  }[];
}
