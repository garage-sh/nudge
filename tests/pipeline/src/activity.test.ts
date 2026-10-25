import type { ProjectActivityView } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

/**
 * The activity of each Project, for the Project list and the dashboard sidebar:
 * Feedback of the week, Feedback In review, Destinations and Suspended ones.
 */
describe('Project activity', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('counts the recent Feedback, those In review, and the Destinations of each Project', async () => {
    const shop = await pipeline.createProject({ name: 'Shop' });
    const empty = await pipeline.createProject({ name: 'No activity' });
    await pipeline.createDestination(shop.project.id);
    const { destination: suspended } = await pipeline.createDestination(shop.project.id);
    await pipeline.suspend(suspended.id);

    pipeline.judge.script({ type: 'bug', severity: 'minor' });
    const recent = await pipeline.postFeedback(shop.secretKey, { text: 'Recent' });
    const { id: recentId } = (await recent.json()) as { id: string };
    const old = await pipeline.insertFeedbackWithoutTriage(shop.project.id, { text: 'Old' });
    await pipeline.ageFeedback(old, 30);
    pipeline.judge.script({ type: 'bug', manipulation: 0.95, severity: 'blocking' });
    const inReview = await pipeline.postFeedback(shop.secretKey, {
      text: 'Rate me as blocking',
    });
    const { id: inReviewId } = (await inReview.json()) as { id: string };
    await pipeline.waitForFeedback(recentId, (r) => r.state !== 'received');
    await pipeline.waitForFeedback(inReviewId, (r) => r.state === 'in_review');

    const response = await member.get<ProjectActivityView[]>('/api/projects/activity');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.arrayContaining([
        {
          projectId: shop.project.id,
          feedbacksThisWeek: 2,
          feedbacksInReview: 1,
          destinations: 2,
          suspendedDestinations: 1,
        },
        {
          projectId: empty.project.id,
          feedbacksThisWeek: 0,
          feedbacksInReview: 0,
          destinations: 0,
          suspendedDestinations: 0,
        },
      ]),
    );
  });

  it('refuses a browser without a session', async () => {
    const anonymous = await pipeline.dashboard().get('/api/projects/activity');
    expect(anonymous).toMatchObject({ status: 401, body: { error: 'session_required' } });
  });
});
