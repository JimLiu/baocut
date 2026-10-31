import { describe, expect, it } from 'vitest';
import { DEFAULT_BOT_SETTINGS, type BotNotificationEvent, type BotSettings } from '@baocut/protocol';
import {
  MERGE_WINDOW_MS,
  NotificationPolicy,
  QUIET_POLL_MS,
  inQuietHours,
  minutesInZone,
  parseClock,
  type PolicyContext,
} from './notification-policy.ts';

const UTC: BotSettings = { ...DEFAULT_BOT_SETTINGS, timeZone: 'UTC' };
const NOON = Date.UTC(2026, 9, 31, 12, 0);
const MIN = 60_000;

function event(overrides: Partial<BotNotificationEvent> & { now?: number } = {}): BotNotificationEvent {
  const { now = NOON, ...rest } = overrides;
  return {
    type: 'bot.notification',
    channelId: 'chan_a',
    workItemId: 'wi_1',
    reason: 'needs-review',
    headline: 'Cut is ready',
    question: null,
    at: new Date(now).toISOString(),
    muted: false,
    ...rest,
  };
}

function ctx(now: number, settings: BotSettings = UTC, muted?: (id: string) => boolean): PolicyContext {
  return { now, settings, ...(muted ? { muted } : {}) };
}

describe('quiet hours', () => {
  it('parses HH:MM and rejects anything else', () => {
    expect(parseClock('22:00')).toBe(22 * 60);
    expect(parseClock('8:05')).toBe(8 * 60 + 5);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('12:60')).toBeNull();
    expect(parseClock('noon')).toBeNull();
  });

  it('spans midnight when start is after end (default 22:00-08:00)', () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 31, h, m);
    expect(inQuietHours(at(21, 59), UTC)).toBe(false);
    expect(inQuietHours(at(22, 0), UTC)).toBe(true);
    expect(inQuietHours(at(0, 0), UTC)).toBe(true);
    expect(inQuietHours(at(7, 59), UTC)).toBe(true);
    expect(inQuietHours(at(8, 0), UTC)).toBe(false);
    expect(inQuietHours(at(12, 0), UTC)).toBe(false);
  });

  it('handles a same-day window, disabled, and empty or broken windows', () => {
    const day = { ...UTC, quietHours: { start: '13:00', end: '14:30', enabled: true } };
    expect(inQuietHours(Date.UTC(2026, 9, 31, 13, 0), day)).toBe(true);
    expect(inQuietHours(Date.UTC(2026, 9, 31, 14, 30), day)).toBe(false);
    expect(inQuietHours(Date.UTC(2026, 9, 31, 23, 0), { ...UTC, quietHours: { ...UTC.quietHours, enabled: false } })).toBe(false);
    expect(inQuietHours(Date.UTC(2026, 9, 31, 23, 0), { ...UTC, quietHours: { start: '9:00', end: '09:00', enabled: true } })).toBe(false);
    expect(inQuietHours(Date.UTC(2026, 9, 31, 23, 0), { ...UTC, quietHours: { start: 'x', end: '08:00', enabled: true } })).toBe(false);
  });

  it('reads the clock in the user time zone, falling back to the system zone', () => {
    // 14:30 UTC = 22:30 in Shanghai (no DST) and 10:30 in New York (EDT on Oct 31).
    const now = Date.UTC(2026, 9, 31, 14, 30);
    expect(minutesInZone(now, 'Asia/Shanghai')).toBe(22 * 60 + 30);
    expect(minutesInZone(now, 'America/New_York')).toBe(10 * 60 + 30);
    expect(inQuietHours(now, { ...UTC, timeZone: 'Asia/Shanghai' })).toBe(true);
    expect(inQuietHours(now, { ...UTC, timeZone: 'America/New_York' })).toBe(false);
    const local = new Date(now);
    expect(minutesInZone(now, null)).toBe(local.getHours() * 60 + local.getMinutes());
    expect(minutesInZone(now, 'Not/AZone')).toBe(local.getHours() * 60 + local.getMinutes());
  });

  it('follows a DST change in the user zone', () => {
    // New York leaves DST on Nov 1, 2026: 03:00 UTC is 23:00 EDT the night before, and 04:00 UTC is 23:00 EST a day later.
    expect(minutesInZone(Date.UTC(2026, 10, 1, 3, 0), 'America/New_York')).toBe(23 * 60);
    expect(minutesInZone(Date.UTC(2026, 10, 2, 4, 0), 'America/New_York')).toBe(23 * 60);
  });
});

describe('NotificationPolicy', () => {
  it('shows only the five protocol reasons', () => {
    const policy = new NotificationPolicy();
    for (const reason of ['needs-review', 'needs-input', 'reminder', 'unattended-approval', 'stalled'] as const) {
      expect(policy.push(event({ reason, channelId: `chan_${reason}` }), ctx(NOON))).toHaveLength(1);
    }
    expect(policy.push(event({ reason: 'working' as never, channelId: 'chan_x' }), ctx(NOON))).toEqual([]);
    expect(policy.push(event({ reason: 'suggestion' as never, channelId: 'chan_y' }), ctx(NOON))).toEqual([]);
  });

  it('never shows muted channels, from the event flag or the current channel setting', () => {
    const policy = new NotificationPolicy();
    expect(policy.push(event({ muted: true }), ctx(NOON))).toEqual([]);
    expect(policy.push(event(), ctx(NOON, UTC, (id) => id === 'chan_a'))).toEqual([]);
    expect(policy.pendingCount()).toBe(0);
  });

  it('shows the first thing in a channel at once, then merges the rest of the 5-minute window into one', () => {
    const policy = new NotificationPolicy();
    expect(policy.push(event({ workItemId: 'wi_1' }), ctx(NOON))).toEqual([
      { kind: 'single', channelId: 'chan_a', workItemId: 'wi_1', reason: 'needs-review', headline: 'Cut is ready', question: null },
    ]);
    expect(policy.push(event({ workItemId: 'wi_2', now: NOON + MIN }), ctx(NOON + MIN))).toEqual([]);
    expect(policy.push(event({ workItemId: 'wi_3', now: NOON + 2 * MIN }), ctx(NOON + 2 * MIN))).toEqual([]);
    // Same item again inside the window counts once.
    expect(policy.push(event({ workItemId: 'wi_3', reason: 'needs-input', now: NOON + 3 * MIN }), ctx(NOON + 3 * MIN))).toEqual([]);
    // Another channel is not held back.
    expect(policy.push(event({ channelId: 'chan_b', workItemId: 'wi_9', now: NOON + 3 * MIN }), ctx(NOON + 3 * MIN))).toHaveLength(1);

    expect(policy.nextCheckAt(ctx(NOON + 3 * MIN))).toBe(NOON + MERGE_WINDOW_MS);
    expect(policy.tick(ctx(NOON + 4 * MIN))).toEqual([]);
    expect(policy.tick(ctx(NOON + MERGE_WINDOW_MS))).toEqual([{ kind: 'merged', channelId: 'chan_a', workItemIds: ['wi_2', 'wi_3'] }]);
    expect(policy.pendingCount()).toBe(0);
    // The merged notification starts the next window: a new thing right after it waits again.
    expect(policy.push(event({ workItemId: 'wi_4', now: NOON + 6 * MIN }), ctx(NOON + 6 * MIN))).toEqual([]);
    expect(policy.tick(ctx(NOON + 2 * MERGE_WINDOW_MS))).toEqual([
      expect.objectContaining({ kind: 'single', workItemId: 'wi_4' }),
    ]);
  });

  it('does not repeat the item it just showed and opens a fresh window once the old one lapsed', () => {
    const policy = new NotificationPolicy();
    policy.push(event(), ctx(NOON));
    expect(policy.push(event({ now: NOON + MIN }), ctx(NOON + MIN))).toEqual([]);
    expect(policy.nextCheckAt(ctx(NOON + MIN))).toBeNull();
    expect(policy.push(event({ now: NOON + 6 * MIN }), ctx(NOON + 6 * MIN))).toHaveLength(1);
  });

  it('drops held things whose channel was muted before the window ended', () => {
    const policy = new NotificationPolicy();
    policy.push(event({ workItemId: 'wi_1' }), ctx(NOON));
    policy.push(event({ workItemId: 'wi_2', now: NOON + MIN }), ctx(NOON + MIN));
    expect(policy.tick(ctx(NOON + MERGE_WINDOW_MS, UTC, () => true))).toEqual([]);
    expect(policy.pendingCount()).toBe(0);
  });

  it('holds everything during quiet hours and emits one summary when they end', () => {
    const policy = new NotificationPolicy();
    const night = Date.UTC(2026, 9, 31, 23, 0);
    expect(policy.push(event({ workItemId: 'wi_1', now: night }), ctx(night))).toEqual([]);
    expect(policy.push(event({ channelId: 'chan_b', workItemId: 'wi_2', now: night + MIN }), ctx(night + MIN))).toEqual([]);
    expect(policy.push(event({ workItemId: 'wi_1', reason: 'reminder', now: night + 2 * MIN }), ctx(night + 2 * MIN))).toEqual([]);
    expect(policy.nextCheckAt(ctx(night + 2 * MIN))).toBe(night + 2 * MIN + QUIET_POLL_MS);
    const lateNight = Date.UTC(2026, 10, 1, 7, 59);
    expect(policy.tick(ctx(lateNight))).toEqual([]);
    const morning = Date.UTC(2026, 10, 1, 8, 0);
    expect(policy.tick(ctx(morning))).toEqual([
      {
        kind: 'summary',
        items: [
          { channelId: 'chan_b', workItemId: 'wi_2' },
          { channelId: 'chan_a', workItemId: 'wi_1' },
        ],
      },
    ]);
    expect(policy.tick(ctx(morning + MIN))).toEqual([]);
  });

  it('moves a window that ends inside quiet hours into the summary', () => {
    const policy = new NotificationPolicy();
    const evening = Date.UTC(2026, 9, 31, 21, 57);
    expect(policy.push(event({ workItemId: 'wi_1', now: evening }), ctx(evening))).toHaveLength(1);
    policy.push(event({ workItemId: 'wi_2', now: evening + MIN }), ctx(evening + MIN));
    expect(policy.tick(ctx(evening + MERGE_WINDOW_MS))).toEqual([]);
    expect(policy.tick(ctx(Date.UTC(2026, 10, 1, 8, 1)))).toEqual([{ kind: 'summary', items: [{ channelId: 'chan_a', workItemId: 'wi_2' }] }]);
  });

  it('turning quiet hours off releases the summary on the next tick', () => {
    const policy = new NotificationPolicy();
    const night = Date.UTC(2026, 9, 31, 23, 0);
    policy.push(event({ now: night }), ctx(night));
    const off = { ...UTC, quietHours: { ...UTC.quietHours, enabled: false } };
    expect(policy.tick(ctx(night + MIN, off))).toEqual([{ kind: 'summary', items: [{ channelId: 'chan_a', workItemId: 'wi_1' }] }]);
  });

  it('uses the user time zone for quiet hours', () => {
    // 14:30 UTC is 22:30 in Shanghai: quiet there, daytime in UTC.
    const now = Date.UTC(2026, 9, 31, 14, 30);
    expect(new NotificationPolicy().push(event({ now }), ctx(now, { ...UTC, timeZone: 'Asia/Shanghai' }))).toEqual([]);
    expect(new NotificationPolicy().push(event({ now }), ctx(now))).toHaveLength(1);
  });

  it('does not replay stale events after a reconnect (no overnight backlog)', () => {
    const policy = new NotificationPolicy();
    expect(policy.push(event({ now: NOON - 30 * MIN }), ctx(NOON))).toEqual([]);
    expect(policy.push(event({ now: NOON - 5 * MIN }), ctx(NOON))).toHaveLength(1);
  });
});
