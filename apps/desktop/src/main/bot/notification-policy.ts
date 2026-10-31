import type { BotNotificationEvent, BotNotificationReason, BotSettings, Id, WorkItemQuestion } from '@baocut/protocol';

/**
 * Bot 的系统通知该怎么弹（技术方案 §15.2、§16.3，需求 BOT-NF-08、§11.8）。纯逻辑，没有计时器、没有 Electron：调用方把
 * 事件与当前时刻喂进来，按返回的决定弹通知，并在 `nextCheckAt` 时再调一次 `tick`。
 *
 * - 只有五种原因发通知；静音频道（事件的 `muted` 或频道当前的设置）永远不弹，只进角标与收件箱。
 * - 按频道合并：一个频道第一件事立刻弹；之后 5 分钟内同频道的事攒着，窗口到点时合成一条（只有一件就照常弹那一件），
 *   并开始下一个窗口。所以一个频道最多 5 分钟弹一次。同一任务同一原因在窗口里只算一次。
 * - 免打扰时段（`quietHours`，按 `timeZone`，null = 系统时区；跨午夜照常）：时段内的事全部攒着，时段结束后合成一条
 *   「夜里有 n 件等你」。
 * - 太旧的事件（重连后补发的）不弹：不补发整夜的消息（BOT-S11），角标照样从频道计数来。
 */

export const MERGE_WINDOW_MS = 5 * 60_000;
/** 比这更早的事件只算角标（断线重连按 `afterSeq` 补发的那些）。 */
export const STALE_EVENT_MS = 10 * 60_000;
/** 免打扰时段里攒着事时多久看一次时段结束了没有。 */
export const QUIET_POLL_MS = 60_000;

export const NOTIFY_REASONS: ReadonlySet<BotNotificationReason> = new Set<BotNotificationReason>([
  'needs-review',
  'needs-input',
  'reminder',
  'unattended-approval',
  'stalled',
]);

export type NotificationDecision =
  | {
      kind: 'single';
      channelId: Id;
      workItemId: Id;
      reason: BotNotificationReason;
      headline: string;
      question: WorkItemQuestion | null;
    }
  /** 同一频道窗口里攒下的多件事。 */
  | { kind: 'merged'; channelId: Id; workItemIds: Id[] }
  /** 免打扰时段结束时的汇总。 */
  | { kind: 'summary'; items: { channelId: Id; workItemId: Id }[] };

export interface PolicyContext {
  now: number;
  settings: Pick<BotSettings, 'quietHours' | 'timeZone'>;
  /** 频道当前是否静音（事件发出之后用户可能刚改）。 */
  muted?: (channelId: Id) => boolean;
}

interface ChannelWindow {
  until: number;
  /** 窗口里攒着的事，按任务 id 去重（留最新的）。 */
  held: Map<Id, BotNotificationEvent>;
  /** 这个窗口里已经弹过的「任务:原因」，同样的事不再攒。 */
  shown: Set<string>;
}

export class NotificationPolicy {
  readonly #windows = new Map<Id, ChannelWindow>();
  /** 免打扰时段里攒着的事，按任务 id 去重。 */
  readonly #quiet = new Map<Id, BotNotificationEvent>();

  /** 收到一条 `bot.notification`。返回此刻该弹的通知（也会顺带结算已经到点的窗口）。 */
  push(event: BotNotificationEvent, ctx: PolicyContext): NotificationDecision[] {
    if (!NOTIFY_REASONS.has(event.reason) || isMuted(event, ctx)) return [];
    const at = Date.parse(event.at);
    if (Number.isFinite(at) && ctx.now - at > STALE_EVENT_MS) return [];
    const decisions = this.tick(ctx);
    if (inQuietHours(ctx.now, ctx.settings)) {
      this.#quiet.delete(event.workItemId);
      this.#quiet.set(event.workItemId, event);
      return decisions;
    }
    const key = `${event.workItemId}:${event.reason}`;
    const window = this.#windows.get(event.channelId);
    if (window && ctx.now < window.until) {
      if (!window.shown.has(key)) window.held.set(event.workItemId, event);
      return decisions;
    }
    this.#windows.set(event.channelId, { until: ctx.now + MERGE_WINDOW_MS, held: new Map(), shown: new Set([key]) });
    decisions.push(single(event));
    return decisions;
  }

  /** 结算到点的合并窗口与免打扰时段的汇总。 */
  tick(ctx: PolicyContext): NotificationDecision[] {
    const decisions: NotificationDecision[] = [];
    const quiet = inQuietHours(ctx.now, ctx.settings);
    for (const [channelId, window] of this.#windows) {
      if (ctx.now < window.until) continue;
      const held = [...window.held.values()].filter((event) => !isMuted(event, ctx));
      if (held.length === 0) {
        this.#windows.delete(channelId);
        continue;
      }
      if (quiet) {
        for (const event of held) this.#quiet.set(event.workItemId, event);
        this.#windows.delete(channelId);
        continue;
      }
      decisions.push(held.length === 1 ? single(held[0]!) : { kind: 'merged', channelId, workItemIds: held.map((event) => event.workItemId) });
      this.#windows.set(channelId, {
        until: ctx.now + MERGE_WINDOW_MS,
        held: new Map(),
        shown: new Set(held.map((event) => `${event.workItemId}:${event.reason}`)),
      });
    }
    if (!quiet && this.#quiet.size > 0) {
      const items = [...this.#quiet.values()]
        .filter((event) => !isMuted(event, ctx))
        .map((event) => ({ channelId: event.channelId, workItemId: event.workItemId }));
      this.#quiet.clear();
      if (items.length > 0) decisions.push({ kind: 'summary', items });
    }
    return decisions;
  }

  /** 下一次需要 `tick` 的时刻；没有攒着的事时 null。 */
  nextCheckAt(ctx: PolicyContext): number | null {
    let next: number | null = null;
    for (const window of this.#windows.values()) {
      if (window.held.size > 0 && (next === null || window.until < next)) next = window.until;
    }
    if (this.#quiet.size > 0) {
      const poll = ctx.now + QUIET_POLL_MS;
      if (next === null || poll < next) next = poll;
    }
    return next;
  }

  /** 攒着还没弹的事数（测试与诊断用）。 */
  pendingCount(): number {
    let count = this.#quiet.size;
    for (const window of this.#windows.values()) count += window.held.size;
    return count;
  }

  clear(): void {
    this.#windows.clear();
    this.#quiet.clear();
  }
}

function single(event: BotNotificationEvent): NotificationDecision {
  return {
    kind: 'single',
    channelId: event.channelId,
    workItemId: event.workItemId,
    reason: event.reason,
    headline: event.headline,
    question: event.question,
  };
}

function isMuted(event: BotNotificationEvent, ctx: PolicyContext): boolean {
  return event.muted || ctx.muted?.(event.channelId) === true;
}

// ---- 免打扰时段 ----

/** `HH:MM`（24 小时制）→ 一天里的第几分钟；认不得时 null。 */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(timeZone: string | null): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let formatter = formatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: timeZone ?? undefined, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    } catch {
      // 认不得的时区（设置写坏了）：按系统时区。
      formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    }
    formatters.set(key, formatter);
  }
  return formatter;
}

/** `now` 在给定时区（null = 系统时区）是一天里的第几分钟。 */
export function minutesInZone(now: number, timeZone: string | null): number {
  let hours = 0;
  let minutes = 0;
  for (const part of clockFormatter(timeZone).formatToParts(new Date(now))) {
    if (part.type === 'hour') hours = Number(part.value) % 24;
    else if (part.type === 'minute') minutes = Number(part.value);
  }
  return hours * 60 + minutes;
}

/**
 * 此刻是否在免打扰时段里。开始晚于结束（22:00–08:00）时跨午夜；开始等于结束或写坏了时当作没有时段。区间含开始、不含结束。
 */
export function inQuietHours(now: number, settings: Pick<BotSettings, 'quietHours' | 'timeZone'>): boolean {
  const { quietHours, timeZone } = settings;
  if (!quietHours.enabled) return false;
  const start = parseClock(quietHours.start);
  const end = parseClock(quietHours.end);
  if (start === null || end === null || start === end) return false;
  const minute = minutesInZone(now, timeZone);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
