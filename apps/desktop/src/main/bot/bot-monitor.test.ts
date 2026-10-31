import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, type BotNotificationEvent } from '@baocut/protocol';
import { BotMonitor } from './bot-monitor.ts';
import { TrayController } from './tray.ts';
import { FakeClient, FakeNotifier, FakeTimers, FakeTrayHost, botStatus, channelSummary, channelsSnapshot } from './testing/fakes.ts';

beforeEach(() => {
  vi.stubEnv('BAOCUT_LOCALE', 'en');
  setLocale('en');
});

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

const MIN = 60_000;

function setup(platform: NodeJS.Platform = 'darwin') {
  const fake = new FakeClient();
  const timers = new FakeTimers();
  const notifier = new FakeNotifier();
  const hosts: FakeTrayHost[] = [];
  const routes: unknown[] = [];
  const residency: { resident: boolean; paused: boolean | null }[] = [];
  const loginSync = vi.fn();
  let monitor: BotMonitor | null = null;
  const tray = new TrayController(
    () => {
      const host = new FakeTrayHost();
      hosts.push(host);
      return host;
    },
    {
      openWindow: vi.fn(),
      openTask: vi.fn(),
      setPaused: (paused) => void monitor!.setPaused(paused),
      quitService: vi.fn(),
    },
    platform,
  );
  monitor = new BotMonitor({
    client: fake.client,
    notifier,
    tray,
    loginItem: { sync: loginSync },
    openRoute: (route) => routes.push(route),
    onResidency: (resident, status) => residency.push({ resident, paused: status?.paused ?? null }),
    now: () => timers.now,
    timers,
  });
  monitor.start();
  return { monitor, fake, timers, notifier, hosts, routes, residency, loginSync, tray };
}

function notification(timers: FakeTimers, overrides: Partial<BotNotificationEvent> = {}): BotNotificationEvent {
  return {
    type: 'bot.notification',
    channelId: 'chan_pod',
    workItemId: 'wi_1',
    reason: 'needs-review',
    headline: 'The cut is ready',
    question: null,
    at: new Date(timers.now).toISOString(),
    muted: false,
    ...overrides,
  };
}

/** Lets pending promises (status requests) settle. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('BotMonitor', () => {
  it('subscribes channels, shows the tray when background is on, and drives the badge from needsYou counts', async () => {
    const { monitor, fake, hosts } = setup();
    expect(fake.handlers).not.toBeNull();
    fake.snapshot(
      channelsSnapshot([
        channelSummary('chan_main', { needsYou: 1 }),
        channelSummary('chan_pod', { name: 'Weekly podcast', needsYou: 2, muted: true }),
      ]),
    );
    await monitor.ready;
    expect(hosts).toHaveLength(1);
    // Muted channels count toward the badge.
    expect(monitor.needsYou).toBe(3);
    expect(hosts[0]!.title).toBe('3');

    fake.event({ type: 'channel.upsert', summary: channelSummary('chan_main', { needsYou: 0 }) });
    expect(hosts[0]!.title).toBe('2');
    fake.event({ type: 'channel.removed', id: 'chan_pod' });
    expect(hosts[0]!.title).toBe('');
  });

  it('hides the tray when background is turned off', async () => {
    const { fake, hosts } = setup();
    fake.snapshot(channelsSnapshot([channelSummary('chan_main')]));
    await flush();
    fake.event({ type: 'bot.settings', settings: { ...channelsSnapshot([]).settings, background: false } });
    expect(hosts[0]!.destroyed).toBe(true);
  });

  it('is resident only when background is on and the Runtime has work to wait for', async () => {
    const { monitor, fake, timers, residency } = setup();
    fake.status = botStatus({ resident: true });
    fake.snapshot(channelsSnapshot([channelSummary('chan_main')]));
    await monitor.ready;
    expect(monitor.resident).toBe(true);
    expect(residency).toEqual([{ resident: true, paused: false }]);

    // Turning background off ends residency even with work waiting.
    fake.event({ type: 'bot.settings', settings: { ...monitor.settings!, background: false } });
    await flush();
    expect(monitor.resident).toBe(false);

    fake.event({ type: 'bot.settings', settings: { ...monitor.settings!, background: true } });
    await flush();
    expect(monitor.resident).toBe(true);

    // The work runs out: picked up by the next poll.
    fake.status = botStatus({ resident: false });
    timers.advance(60_000);
    await flush();
    expect(monitor.resident).toBe(false);
    expect(residency.map((r) => r.resident)).toEqual([true, false, true, false]);
  });

  it('re-reads bot.status shortly after channel changes, once per burst', async () => {
    const { monitor, fake, timers } = setup();
    fake.snapshot(channelsSnapshot([channelSummary('chan_main')]));
    await monitor.ready;
    const before = fake.requests.filter((r) => r.method === 'bot.status').length;
    fake.status = botStatus({ resident: true, workingThreads: [{ workItemId: 'wi_1', channelId: 'chan_main', title: 'Trim' }] });
    fake.event({ type: 'channel.upsert', summary: channelSummary('chan_main') });
    fake.event({ type: 'channel.upsert', summary: channelSummary('chan_main') });
    timers.advance(1_500);
    await flush();
    expect(fake.requests.filter((r) => r.method === 'bot.status').length).toBe(before + 1);
    expect(monitor.status?.workingThreads).toHaveLength(1);
    expect(monitor.resident).toBe(true);
  });

  it('keeps going when bot.status is not available (older Runtime): not resident', async () => {
    const { monitor, fake, hosts } = setup();
    fake.statusError = new Error('unknown method');
    fake.snapshot(channelsSnapshot([channelSummary('chan_main', { needsYou: 1 })]));
    await monitor.ready;
    expect(monitor.resident).toBe(false);
    expect(hosts[0]!.title).toBe('1');
  });

  it('pauses and resumes automation from the tray', async () => {
    const { monitor, fake, hosts } = setup();
    fake.snapshot(channelsSnapshot([channelSummary('chan_main')]));
    await monitor.ready;
    hosts[0]!.menu[3]!.click!();
    await flush();
    expect(fake.requests).toContainEqual({ method: 'bot.pauseAutomation', params: { paused: true } });
    expect(hosts[0]!.menu[3]!.label).toBe('Resume Automation');
    hosts[0]!.menu[3]!.click!();
    await flush();
    expect(fake.requests).toContainEqual({ method: 'bot.pauseAutomation', params: { paused: false } });
    expect(hosts[0]!.menu[3]!.label).toBe('Pause All Automation');
  });

  it('syncs the login item from settings.openAtLogin when it changes', async () => {
    const { monitor, fake, loginSync } = setup();
    fake.snapshot(channelsSnapshot([], { openAtLogin: false }));
    await monitor.ready;
    expect(loginSync).toHaveBeenCalledWith(false);
    fake.event({ type: 'bot.settings', settings: { ...monitor.settings!, maxConcurrentThreads: 4 } });
    expect(loginSync).toHaveBeenCalledTimes(1);
    fake.event({ type: 'bot.settings', settings: { ...monitor.settings!, openAtLogin: true } });
    expect(loginSync).toHaveBeenLastCalledWith(true);
  });

  it('notifies with the channel name and report headline; clicking routes to the task', async () => {
    const { monitor, fake, timers, notifier, routes } = setup();
    fake.snapshot(channelsSnapshot([channelSummary('chan_pod', { name: 'Weekly podcast' })]));
    await monitor.ready;
    fake.event(notification(timers));
    expect(notifier.shown.map((n) => n.content)).toEqual([
      { title: 'Weekly podcast', subtitle: 'Ready for your review', body: 'The cut is ready' },
    ]);
    notifier.shown[0]!.click();
    expect(routes).toEqual([{ tab: 'bot', channelId: 'chan_pod', workItemId: 'wi_1', view: 'task' }]);
  });

  it('merges a channel’s notifications within 5 minutes and routes the merged one to the channel', async () => {
    const { monitor, fake, timers, notifier, routes } = setup();
    fake.snapshot(channelsSnapshot([channelSummary('chan_pod', { name: 'Weekly podcast' })]));
    await monitor.ready;
    fake.event(notification(timers));
    timers.advance(MIN);
    fake.event(notification(timers, { workItemId: 'wi_2', reason: 'needs-input' }));
    timers.advance(MIN);
    fake.event(notification(timers, { workItemId: 'wi_3', reason: 'stalled' }));
    expect(notifier.shown).toHaveLength(1);
    timers.advance(3 * MIN);
    expect(notifier.shown).toHaveLength(2);
    expect(notifier.shown[1]!.content).toEqual({ title: 'Weekly podcast', body: '2 things need you in Weekly podcast' });
    notifier.shown[1]!.click();
    expect(routes).toEqual([{ tab: 'bot', channelId: 'chan_pod', workItemId: null, view: 'channel' }]);
  });

  it('never pops up for a muted channel, but the badge still counts it', async () => {
    const { monitor, fake, timers, notifier, hosts } = setup();
    fake.snapshot(channelsSnapshot([channelSummary('chan_pod', { muted: true, needsYou: 1 })]));
    await monitor.ready;
    fake.event(notification(timers));
    fake.event(notification(timers, { channelId: 'chan_other', muted: true }));
    expect(notifier.shown).toHaveLength(0);
    expect(hosts[0]!.title).toBe('1');
  });

  it('holds notifications during quiet hours and summarizes them when quiet hours end', async () => {
    const { monitor, fake, timers, notifier, routes } = setup();
    timers.now = Date.UTC(2026, 9, 31, 23, 0);
    fake.snapshot(channelsSnapshot([channelSummary('chan_a', { name: 'A' }), channelSummary('chan_b', { name: 'B' })]));
    await monitor.ready;
    fake.event(notification(timers, { channelId: 'chan_a', workItemId: 'wi_1' }));
    timers.advance(2 * 60 * MIN);
    fake.event(notification(timers, { channelId: 'chan_b', workItemId: 'wi_2', reason: 'unattended-approval' }));
    expect(notifier.shown).toHaveLength(0);
    // 08:00 UTC next morning.
    timers.advance(7 * 60 * MIN);
    expect(notifier.shown.map((n) => n.content)).toEqual([{ title: 'BaoCut', body: '2 things waited for you overnight' }]);
    notifier.shown[0]!.click();
    expect(routes).toEqual([{ tab: 'bot', channelId: null, workItemId: null, view: 'inbox' }]);
  });

  it('a one-item overnight summary routes straight to that task', async () => {
    const { monitor, fake, timers, notifier, routes } = setup();
    timers.now = Date.UTC(2026, 9, 31, 7, 30);
    fake.snapshot(channelsSnapshot([channelSummary('chan_a')]));
    await monitor.ready;
    fake.event(notification(timers, { channelId: 'chan_a', workItemId: 'wi_9', reason: 'reminder' }));
    timers.advance(31 * MIN);
    expect(notifier.shown.map((n) => n.content.body)).toEqual(['1 thing waited for you overnight']);
    notifier.shown[0]!.click();
    expect(routes).toEqual([{ tab: 'bot', channelId: 'chan_a', workItemId: 'wi_9', view: 'task' }]);
  });

  it('falls back to the question or reason when there is no headline, and to the app name without a channel', async () => {
    const { monitor, fake, timers, notifier } = setup();
    fake.snapshot(channelsSnapshot([]));
    await monitor.ready;
    fake.event(
      notification(timers, {
        channelId: 'chan_x',
        headline: '  ',
        reason: 'needs-input',
        question: { text: 'Which title?', kind: 'input', options: [], pick: null, risky: false, askedBy: 'thread', approvalId: null },
      }),
    );
    fake.event(notification(timers, { channelId: 'chan_y', headline: '', reason: 'stalled' }));
    expect(notifier.shown.map((n) => n.content)).toEqual([
      { title: 'BaoCut', subtitle: 'Needs your input', body: 'Which title?' },
      { title: 'BaoCut', subtitle: 'Stopped and needs a look', body: 'Stopped and needs a look' },
    ]);
  });

  it('dispose unsubscribes, stops timers, closes the client and removes the tray', async () => {
    const { monitor, fake, timers, hosts } = setup();
    fake.snapshot(channelsSnapshot([channelSummary('chan_main')]));
    await monitor.ready;
    monitor.dispose();
    expect(fake.unsubscribed).toBe(true);
    expect(fake.closed).toBe(true);
    expect(hosts[0]!.destroyed).toBe(true);
    expect(timers.intervals.size).toBe(0);
    expect(timers.timeouts.size).toBe(0);
  });
});
