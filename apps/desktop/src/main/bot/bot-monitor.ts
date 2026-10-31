import { applyChannelsEvent, type BaoCutClient } from '@baocut/client';
import type { BotSettings, BotStatus, ChannelSummary, ChannelsEvent, ChannelsSnapshot, Id } from '@baocut/protocol';
import { B } from './bot-copy.ts';
import { INBOX_ROUTE, channelRoute, taskRoute, type BotRoute } from './bot-route.ts';
import { NotificationPolicy, type NotificationDecision, type PolicyContext } from './notification-policy.ts';
import type { TrayController } from './tray.ts';

/**
 * 主进程自己连着 Runtime 的那一路（技术方案 §15.2「主进程订阅」）：窗口全关时界面不在，托盘角标、系统通知与常驻判断都靠它。
 *
 * - 只订阅 `channels` 主题：快照里有各频道的计数与 `BotSettings`，事件里有 `bot.notification`。
 * - 角标 = 各频道 `needsYou` 之和（含静音频道，与 Rail 徽标一致）。
 * - 通知经 `NotificationPolicy`（合并、免打扰、静音），点通知打开窗口并路由到任务（`openRoute`）。
 * - 常驻 = `settings.background` 且 `bot.status().resident`。`bot.status` 在拿到快照、频道变化（去抖）、设置变化与每分钟
 *   轮询时重取；协议里没有单独的状态事件。变化时调 `onResidency`（告诉 Runtime 与窗口生命周期）。
 * - `settings.openAtLogin` 变化时同步系统登录项；`settings.background` 决定托盘在不在。
 *
 * 不碰 Electron：客户端、通知、托盘、登录项、计时器都由调用方注入，测试用假的。
 */

export type BotClient = Pick<BaoCutClient, 'subscribeChannels' | 'request' | 'close'>;

export interface NotificationContent {
  title: string;
  /** macOS 的副标题；别的平台忽略。 */
  subtitle?: string;
  body: string;
}

export interface NotificationHost {
  show(content: NotificationContent, onClick: () => void): void;
}

export interface MonitorTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface BotMonitorOptions {
  client: BotClient;
  notifier: NotificationHost;
  tray: TrayController | null;
  loginItem: { sync(openAtLogin: boolean): unknown } | null;
  openRoute(route: BotRoute): void;
  /** 常驻状态变化（只在变化时调）。 */
  onResidency(resident: boolean, status: BotStatus | null): void;
  now?: () => number;
  timers?: MonitorTimers;
  /** `bot.status` 的轮询间隔。 */
  statusPollMs?: number;
  /** 频道变化后多久重取 `bot.status`。 */
  statusDebounceMs?: number;
  log?: (message: string, detail?: unknown) => void;
}

const DEFAULT_TIMERS: MonitorTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

const TITLE_CHARS = 200;
const BODY_CHARS = 500;
/** 通知标题里的产品名（品牌，不翻译）。 */
const APP_NAME = 'BaoCut';

export class BotMonitor {
  readonly #options: BotMonitorOptions;
  readonly #timers: MonitorTimers;
  readonly #now: () => number;
  readonly #policy = new NotificationPolicy();
  #snapshot: ChannelsSnapshot | null = null;
  #status: BotStatus | null = null;
  #resident = false;
  #unsubscribe: (() => void) | null = null;
  #pollTimer: unknown = null;
  #debounceTimer: unknown = null;
  #tickTimer: unknown = null;
  #tickAt: number | null = null;
  #refreshing: Promise<BotStatus | null> | null = null;
  #refreshAgain = false;
  #disposed = false;
  #markReady: () => void = () => {};
  /** 第一次拿到快照并取过一次 `bot.status` 之后（成败都算）兑现；`dispose` 时也兑现。 */
  readonly ready: Promise<void>;

  constructor(options: BotMonitorOptions) {
    this.#options = options;
    this.#timers = options.timers ?? DEFAULT_TIMERS;
    this.#now = options.now ?? Date.now;
    this.ready = new Promise((resolve) => {
      this.#markReady = resolve;
    });
  }

  /** 常驻：设置开着后台服务，且 Runtime 说有活要等。 */
  get resident(): boolean {
    return this.#resident;
  }

  get status(): BotStatus | null {
    return this.#status;
  }

  /** 还没拿到快照时 null。 */
  get settings(): BotSettings | null {
    return this.#snapshot?.settings ?? null;
  }

  /** 等你的任务数（含静音频道）。 */
  get needsYou(): number {
    return (this.#snapshot?.channels ?? []).reduce((sum, row) => sum + Math.max(0, row.counts.needsYou), 0);
  }

  start(): void {
    if (this.#unsubscribe || this.#disposed) return;
    this.#unsubscribe = this.#options.client.subscribeChannels({
      snapshot: (snapshot) => this.#onSnapshot(snapshot),
      event: (event) => this.#onEvent(event),
    });
    this.#pollTimer = this.#timers.setInterval(() => void this.refreshStatus(), this.#options.statusPollMs ?? 60_000);
  }

  dispose(): void {
    this.#disposed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    for (const timer of [this.#debounceTimer, this.#tickTimer]) if (timer !== null) this.#timers.clearTimeout(timer);
    if (this.#pollTimer !== null) this.#timers.clearInterval(this.#pollTimer);
    this.#pollTimer = this.#debounceTimer = this.#tickTimer = null;
    this.#policy.clear();
    this.#options.tray?.hide();
    this.#options.client.close();
    this.#markReady();
  }

  /**
   * 重取 `bot.status`，更新托盘与常驻状态。同时只有一个请求在途；在途时又要求的，结束后再取一次。取不到（旧 Runtime 没有这个
   * 方法、断线）时保留上一次的结果。
   */
  refreshStatus(): Promise<BotStatus | null> {
    if (this.#disposed) return Promise.resolve(this.#status);
    if (this.#refreshing) {
      this.#refreshAgain = true;
      return this.#refreshing;
    }
    const run = async (): Promise<BotStatus | null> => {
      do {
        this.#refreshAgain = false;
        try {
          this.#status = await this.#options.client.request('bot.status', {});
        } catch (error) {
          this.#options.log?.('bot.status failed', error);
        }
        if (this.#disposed) return this.#status;
        this.#renderTray();
        this.#updateResidency();
      } while (this.#refreshAgain);
      return this.#status;
    };
    this.#refreshing = run().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  /** 托盘里的「暂停全部自动运行 / 恢复自动运行」。 */
  async setPaused(paused: boolean): Promise<void> {
    await this.#options.client.request('bot.pauseAutomation', { paused });
    if (this.#status) this.#status = { ...this.#status, paused };
    this.#renderTray();
    await this.refreshStatus();
  }

  // ---- 主题 ----

  #onSnapshot(snapshot: ChannelsSnapshot): void {
    const previous = this.#snapshot?.settings ?? null;
    this.#snapshot = snapshot;
    this.#applySettings(previous);
    this.#renderTray();
    void this.refreshStatus().then(() => this.#markReady());
  }

  #onEvent(event: ChannelsEvent): void {
    if (!this.#snapshot) return;
    const previous = this.#snapshot.settings;
    this.#snapshot = applyChannelsEvent(this.#snapshot, event);
    switch (event.type) {
      case 'bot.notification':
        this.#showAll(this.#policy.push(event, this.#context()));
        this.#scheduleTick();
        return;
      case 'bot.settings':
        this.#applySettings(previous);
        // 免打扰时段改了或关了：攒着的可能现在就该弹。
        this.#tick();
        this.#updateResidency();
        void this.refreshStatus();
        return;
      case 'channel.upsert':
      case 'channel.removed':
        this.#renderTray();
        this.#scheduleStatusRefresh();
        return;
    }
  }

  #applySettings(previous: BotSettings | null): void {
    const settings = this.#snapshot?.settings;
    if (!settings) return;
    const tray = this.#options.tray;
    if (tray) {
      if (settings.background) tray.show();
      else tray.hide();
    }
    if (!previous || previous.openAtLogin !== settings.openAtLogin) {
      try {
        this.#options.loginItem?.sync(settings.openAtLogin);
      } catch (error) {
        this.#options.log?.('login item sync failed', error);
      }
    }
  }

  #scheduleStatusRefresh(): void {
    if (this.#debounceTimer !== null || this.#disposed) return;
    this.#debounceTimer = this.#timers.setTimeout(() => {
      this.#debounceTimer = null;
      void this.refreshStatus();
    }, this.#options.statusDebounceMs ?? 1_500);
  }

  #updateResidency(): void {
    const resident = this.#snapshot?.settings.background === true && this.#status?.resident === true;
    if (resident === this.#resident) return;
    this.#resident = resident;
    this.#options.onResidency(resident, this.#status);
  }

  #renderTray(): void {
    const tray = this.#options.tray;
    if (!tray) return;
    tray.update({
      needsYou: this.needsYou,
      working: this.#status?.workingThreads ?? [],
      paused: this.#status?.paused ?? this.#snapshot?.settings.automationPaused ?? false,
    });
  }

  // ---- 通知 ----

  #context(): PolicyContext {
    return {
      now: this.#now(),
      settings: this.#snapshot?.settings ?? { quietHours: { start: '22:00', end: '08:00', enabled: true }, timeZone: null },
      muted: (channelId) => this.#channel(channelId)?.channel.muted === true,
    };
  }

  #tick(): void {
    this.#showAll(this.#policy.tick(this.#context()));
    this.#scheduleTick();
  }

  #scheduleTick(): void {
    if (this.#disposed) return;
    const at = this.#policy.nextCheckAt(this.#context());
    if (at === this.#tickAt) return;
    if (this.#tickTimer !== null) this.#timers.clearTimeout(this.#tickTimer);
    this.#tickTimer = null;
    this.#tickAt = at;
    if (at === null) return;
    this.#tickTimer = this.#timers.setTimeout(
      () => {
        this.#tickTimer = null;
        this.#tickAt = null;
        this.#tick();
      },
      Math.max(0, at - this.#now()),
    );
  }

  #showAll(decisions: readonly NotificationDecision[]): void {
    for (const decision of decisions) {
      const { content, route } = this.#describe(decision);
      try {
        this.#options.notifier.show(content, () => this.#options.openRoute(route));
      } catch (error) {
        this.#options.log?.('notification failed', error);
      }
    }
  }

  #describe(decision: NotificationDecision): { content: NotificationContent; route: BotRoute } {
    switch (decision.kind) {
      case 'single': {
        const reason = B.notifyReason[decision.reason];
        const body = decision.headline.trim() || decision.question?.text.trim() || reason;
        return {
          content: clamp({ title: this.#channelName(decision.channelId) || APP_NAME, subtitle: reason, body }),
          route: taskRoute(decision.channelId, decision.workItemId),
        };
      }
      case 'merged': {
        const name = this.#channelName(decision.channelId);
        return {
          content: clamp({ title: name || APP_NAME, body: B.notifyMerged(decision.workItemIds.length, name || APP_NAME) }),
          route: channelRoute(decision.channelId),
        };
      }
      case 'summary': {
        const only = decision.items.length === 1 ? decision.items[0]! : null;
        return {
          content: clamp({ title: APP_NAME, body: B.notifySummary(decision.items.length) }),
          route: only ? taskRoute(only.channelId, only.workItemId) : INBOX_ROUTE,
        };
      }
    }
  }

  #channel(channelId: Id): ChannelSummary | undefined {
    return this.#snapshot?.channels.find((row) => row.channel.id === channelId);
  }

  #channelName(channelId: Id): string {
    return this.#channel(channelId)?.channel.name.trim() ?? '';
  }
}

function clamp(content: NotificationContent): NotificationContent {
  return {
    title: content.title.slice(0, TITLE_CHARS),
    ...(content.subtitle ? { subtitle: content.subtitle.slice(0, TITLE_CHARS) } : {}),
    body: content.body.slice(0, BODY_CHARS),
  };
}
