import { Inject, Injectable } from '@nestjs/common';
import { deriveFingerprint } from '@nudge/core';
import { recordOccurrence, type Db, type Project } from '@nudge/database';
import type { IncidentReport, ReceivedIncident, ValidatedIncident } from '@nudge/shared';
import { DB } from '../infra/tokens.js';

/** Records an Occurrence: it opens an Incident or is absorbed by the Open one it matches. */
@Injectable()
export class IncidentsIngestionService {
  constructor(@Inject(DB) private readonly db: Db) {}

  receive(project: Project, occurrence: ValidatedIncident): Promise<ReceivedIncident> {
    const report: IncidentReport = {
      title: occurrence.title,
      message: occurrence.message ?? null,
      level: occurrence.level ?? null,
      environment: occurrence.environment ?? null,
      fingerprint: occurrence.fingerprint ?? null,
      context: occurrence.context ?? {},
      receivedAt: new Date().toISOString(),
    };
    return recordOccurrence(this.db, {
      projectId: project.id,
      fingerprint:
        report.fingerprint ?? deriveFingerprint(project.id, report.title, report.environment),
      level: report.level ?? project.defaultLevel,
      report,
    });
  }
}
