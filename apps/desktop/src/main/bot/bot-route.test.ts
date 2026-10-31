import { expect, it } from 'vitest';
import { INBOX_ROUTE, PendingRoute, botRoute, channelRoute, taskRoute } from './bot-route.ts';

it('builds the Bot routes the renderer understands', () => {
  expect(taskRoute('chan_a', 'wi_1')).toEqual({ tab: 'bot', channelId: 'chan_a', workItemId: 'wi_1', view: 'task' });
  expect(channelRoute('chan_a')).toEqual({ tab: 'bot', channelId: 'chan_a', workItemId: null, view: 'channel' });
  expect(INBOX_ROUTE).toEqual({ tab: 'bot', channelId: null, workItemId: null, view: 'inbox' });
});

it('accepts only well-formed routes', () => {
  expect(botRoute(taskRoute('chan_a', 'wi_1'))).toEqual(taskRoute('chan_a', 'wi_1'));
  expect(botRoute(INBOX_ROUTE)).toEqual(INBOX_ROUTE);
  expect(botRoute({ ...taskRoute('chan_a', 'wi_1'), extra: 1 })).toEqual(taskRoute('chan_a', 'wi_1'));
  expect(botRoute({ tab: 'home', channelId: null, workItemId: null, view: 'inbox' })).toBeNull();
  expect(botRoute({ tab: 'bot', channelId: '../x', workItemId: 'wi_1', view: 'task' })).toBeNull();
  expect(botRoute({ tab: 'bot', channelId: 'chan_a', workItemId: null, view: 'task' })).toBeNull();
  expect(botRoute({ tab: 'bot', channelId: null, workItemId: null, view: 'channel' })).toBeNull();
  expect(botRoute({ tab: 'bot', channelId: null, workItemId: null, view: 'memory' })).toBeNull();
  expect(botRoute(null)).toBeNull();
});

it('keeps only the latest pending route and hands it out once', () => {
  const pending = new PendingRoute();
  expect(pending.take()).toBeNull();
  pending.set(channelRoute('chan_a'));
  pending.set(taskRoute('chan_a', 'wi_1'));
  expect(pending.take()).toEqual(taskRoute('chan_a', 'wi_1'));
  expect(pending.take()).toBeNull();
});
