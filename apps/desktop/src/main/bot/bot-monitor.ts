import { applyChannelsEvent, type BaoCutClient } from '@baocut/client';
import {
  MAIN_CHANNEL_ID,
  type BotSettings,
  type BotStatus,
  type ChannelSummary,
  type ChannelsEvent,
  type ChannelsSnapshot,
  type Id,
} from '@baocut/protocol';
import { B } from './bot-copy.ts';
import { channelRoute, taskRoute, type BotRoute } from './bot-route.ts';
import { NotificationPolicy, type NotificationDecision, type PolicyContext } from './notification-policy.ts';
import type { TrayController } from './tray.ts';

/**
 * 主进程自己连着 Runtime 的那一路（技术方案 §15.2「主进程订阅」）：窗口全关时界面不在，托盘、系统通知与常驻判断都靠它。
 *
 * - 只订阅 `channels` 主题：快照里有各频道的计数与 `BotSettings`，事件里有 `bot.notification`。
 * - 托盘不带等你的数字；挂不挂见 `syncTray`。
 * - 通知经 `NotificationPolicy`（合并、免打扰、静音），点通知打开窗口并路由到任务（`openRoute`）。
 * - 常驻 = `settings.background` 且 `bot.status().resident`。`bot.status` 在拿到快照、频道变化（去抖）、设置变化与每分钟
 *   轮询时重取；协议里没有单独的状态事件。变化时调 `onResidency`（告诉 Runtime 与窗口生命周期）。
 * - `settings.openAtLogin` 变化时同步系统登录项。
 * - 功能开关 `features.bot`（`settings` 主题）关着时以上都不做：不订 `channels`、不轮询、不挂托盘、不常驻，并撤下登录项。
 *
 * 不碰 Electron：客户端、通知、托盘、登录项、计时器都由调用方注入，测试用假的。
 */

export type BotClient = Pick<BaoCutClient, 'subscribeChannels' | 'subscribeSettings' | 'request' | 'close'>;

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
  /** 托盘是不是回到应用的唯一入口（Windows / Linux 上窗口全关时）：是的话设置里没开图标也挂上。缺省不是。 */
  trayFallback?: () => boolean;
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
  /** `features.bot`；设置快照到之前 null。 */
  #enabled: boolean | null = null;
  #unsubscribeSettings: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;
  #pollTimer: unknown = null;
  #debounceTimer: unknown = null;
  #tickTimer: unknown = null;
  #tickAt: number | null = null;
  #refreshing: Promise<BotStatus | null> | null = null;
  #refreshAgain = false;
  #disposed = false;
  #markReady: () => void = () => {};
  /** 第一次拿到快照并取过一次 `bot.status` 之后（成败都算）兑现；功能开关关着、`dispose` 时也兑现。 */
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

  start(): void {
    if (this.#unsubscribeSettings || this.#disposed) return;
    this.#unsubscribeSettings = this.#options.client.subscribeSettings({
      snapshot: (snapshot) => this.#setEnabled(snapshot.settings['features.bot']),
      event: (event) => {
        const enabled = event.changed['features.bot'];
        if (enabled !== undefined) this.#setEnabled(enabled);
      },
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#unsubscribeSettings?.();
    this.#unsubscribeSettings = null;
    this.#stopWatching();
    this.#options.client.close();
    this.#markReady();
  }

  #setEnabled(enabled: boolean): void {
    if (enabled === this.#enabled || this.#disposed) return;
    this.#enabled = enabled;
    if (enabled) {
      this.#unsubscribe = this.#options.client.subscribeChannels({
        snapshot: (snapshot) => this.#onSnapshot(snapshot),
        event: (event) => this.#onEvent(event),
      });
      this.#pollTimer = this.#timers.setInterval(() => void this.refreshStatus(), this.#options.statusPollMs ?? 60_000);
      return;
    }
    this.#stopWatching();
    this.#snapshot = null;
    this.#status = null;
    this.#updateResidency();
    // 不留一个开机启动着却什么也不做的后台；再打开时拿到快照会按设置同步回来。
    try {
      this.#options.loginItem?.sync(false);
    } catch (error) {
      this.#options.log?.('login item sync failed', error);
    }
    this.#markReady();
  }

  #stopWatching(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    for (const timer of [this.#debounceTimer, this.#tickTimer]) if (timer !== null) this.#timers.clearTimeout(timer);
    if (this.#pollTimer !== null) this.#timers.clearInterval(this.#pollTimer);
    this.#pollTimer = this.#debounceTimer = this.#tickTimer = null;
    this.#tickAt = null;
    this.#policy.clear();
    this.#options.tray?.hide();
  }

  /**
   * 重取 `bot.status`，更新托盘与常驻状态。同时只有一个请求在途；在途时又要求的，结束后再取一次。取不到（旧 Runtime 没有这个
   * 方法、断线）时保留上一次的结果。
   */
  refreshStatus(): Promise<BotStatus | null> {
    if (this.#disposed || !this.#enabled) return Promise.resolve(this.#status);
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
        // 等回复时开关关了：这份结果不算数。
        if (!this.#enabled) {
          this.#status = null;
          return null;
        }
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

  /**
   * 按设置挂上或拿掉托盘（需求 §11.8）：开着后台服务，且用户在设置里打开了图标（默认关）。Windows / Linux 上窗口全关后应用
   * 还在跑时，托盘是回到应用、退出后台服务的唯一入口，这时设置没开也挂上，开了窗口再拿掉；macOS 有 Dock 图标，不需要。
   * 窗口开关时由调用方再调一次。
   */
  syncTray(): void {
    const tray = this.#options.tray;
    const settings = this.#snapshot?.settings;
    if (!tray || !settings || this.#disposed) return;
    if (settings.background && (settings.trayIcon || this.#options.trayFallback?.() === true)) tray.show();
    else tray.hide();
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
    this.syncTray();
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
        // 一件直接开任务；都在一个频道就开那个频道，否则开主频道（侧栏上有圆点的频道就是等你的）。
        const only = decision.items.length === 1 ? decision.items[0]! : null;
        const channels = new Set(decision.items.map((item) => item.channelId));
        const [channelId] = channels.size === 1 ? channels : [MAIN_CHANNEL_ID];
        return {
          content: clamp({ title: APP_NAME, body: B.notifySummary(decision.items.length) }),
          route: only ? taskRoute(only.channelId, only.workItemId) : channelRoute(channelId!),
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
