import type { TopicHandlers } from '@baocut/client';
import {
  DEFAULT_BOT_SETTINGS,
  type BotSettings,
  type BotStatus,
  type Channel,
  type ChannelSummary,
  type ChannelsEvent,
  type ChannelsSnapshot,
} from '@baocut/protocol';
import type { BotClient, MonitorTimers, NotificationContent, NotificationHost } from '../bot-monitor.ts';
import type { TrayHost, TrayMenuItem } from '../tray.ts';

/** Test doubles for the Electron and Runtime pieces the Bot background service is built on. */

/** Stands in for Electron's Tray + Menu: records what was set. */
export class FakeTrayHost implements TrayHost {
  menu: TrayMenuItem[] = [];
  title = '';
  tooltip = '';
  clickListener: (() => void) | null = null;
  destroyed = false;
  setMenu(items: TrayMenuItem[]) {
    this.menu = items;
  }
  setTitle(title: string) {
    this.title = title;
  }
  setToolTip(text: string) {
    this.tooltip = text;
  }
  onClick(listener: () => void) {
    this.clickListener = listener;
  }
  destroy() {
    this.destroyed = true;
  }
}

/** Stands in for Electron's Notification: keeps what was shown and lets a test click it. */
export class FakeNotifier implements NotificationHost {
  shown: { content: NotificationContent; click: () => void }[] = [];
  show(content: NotificationContent, onClick: () => void) {
    this.shown.push({ content, click: onClick });
  }
}

/** A BaoCutClient stand-in: the test pushes snapshots and events, and answers requests. */
export class FakeClient {
  handlers: TopicHandlers<ChannelsSnapshot, ChannelsEvent> | null = null;
  requests: { method: string; params: unknown }[] = [];
  status: BotStatus = botStatus();
  statusError: Error | null = null;
  closed = false;
  unsubscribed = false;

  get client(): BotClient {
    return {
      subscribeChannels: (handlers: TopicHandlers<ChannelsSnapshot, ChannelsEvent>) => {
        this.handlers = handlers;
        return () => {
          this.unsubscribed = true;
        };
      },
      request: (async (method: string, params: unknown) => {
        this.requests.push({ method, params });
        if (method === 'bot.status') {
          if (this.statusError) throw this.statusError;
          return structuredClone(this.status);
        }
        if (method === 'bot.pauseAutomation') {
          const paused = (params as { paused: boolean }).paused;
          this.status = { ...this.status, paused };
          return { paused };
        }
        throw new Error(`unexpected ${method}`);
      }) as BotClient['request'],
      close: () => {
        this.closed = true;
      },
    };
  }

  snapshot(snapshot: ChannelsSnapshot) {
    this.handlers!.snapshot(snapshot, '1:1' as never);
  }

  event(event: ChannelsEvent) {
    this.handlers!.event(event, '1:2' as never);
  }
}

/** Manual clock and timers. */
export class FakeTimers implements MonitorTimers {
  now = Date.UTC(2026, 9, 31, 12, 0);
  #next = 1;
  readonly timeouts = new Map<number, { at: number; callback: () => void }>();
  readonly intervals = new Map<number, { every: number; next: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number) {
    const id = this.#next++;
    this.timeouts.set(id, { at: this.now + ms, callback });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.timeouts.delete(handle as number);
  }
  setInterval(callback: () => void, ms: number) {
    const id = this.#next++;
    this.intervals.set(id, { every: ms, next: this.now + ms, callback });
    return id;
  }
  clearInterval(handle: unknown) {
    this.intervals.delete(handle as number);
  }

  /** Moves the clock forward, firing due timers in order. */
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      let due: { at: number; run: () => void } | null = null;
      for (const [id, timer] of this.timeouts) {
        if (timer.at <= end && (!due || timer.at < due.at)) {
          due = {
            at: timer.at,
            run: () => {
              this.timeouts.delete(id);
              timer.callback();
            },
          };
        }
      }
      for (const timer of this.intervals.values()) {
        if (timer.next <= end && (!due || timer.next < due.at)) {
          due = {
            at: timer.next,
            run: () => {
              timer.next += timer.every;
              timer.callback();
            },
          };
        }
      }
      if (!due) break;
      this.now = due.at;
      due.run();
    }
    this.now = end;
  }
}

export function botStatus(overrides: Partial<BotStatus> = {}): BotStatus {
  return { workingThreads: [], nextSchedules: [], paused: false, resident: false, needsYou: 0, ...overrides };
}

export function channelSummary(id: string, overrides: { name?: string; muted?: boolean; needsYou?: number } = {}): ChannelSummary {
  const channel = {
    id,
    kind: id === 'chan_main' ? 'main' : 'topic',
    name: overrides.name ?? id,
    muted: overrides.muted ?? false,
  } as Partial<Channel> as Channel;
  return {
    channel,
    unread: false,
    counts: { needsYou: overrides.needsYou ?? 0, working: 0, upNext: 0, suggested: 0, scheduled: 0, open: 0 },
    lastActivityAt: '2026-10-31T00:00:00.000Z',
    spend: null,
  };
}

export function channelsSnapshot(channels: ChannelSummary[], settings: Partial<BotSettings> = {}): ChannelsSnapshot {
  return { channels, groups: [], settings: { ...DEFAULT_BOT_SETTINGS, timeZone: 'UTC', ...settings } };
}
