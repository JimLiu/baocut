import type { Id } from '@baocut/protocol';

/**
 * 从主进程把界面带到 Bot 页的某处（点系统通知、托盘里的任务）。形状与界面的 `Route` 里 Bot 那一支一致（技术方案 §17.1）。
 *
 * 传递方式（主进程 → 渲染进程）：
 * - 主进程先把路由存成「待取」，窗口已经载入时再发 `baocut:bot-route` 提醒；
 * - 渲染进程经 preload 暴露的 `window.baocutBot.onRoute(listener)` 订阅：订阅时与每次收到提醒时都调用
 *   `baocut:bot-take-route`（invoke）把待取的路由取走，取到就交给 listener。所以新开的窗口（通知把应用从托盘里叫回来）
 *   界面挂好之后也拿得到，同一个路由只交付一次。
 *
 * 这个文件不依赖 Electron，preload 也引用它。
 */

export interface BotRoute {
  tab: 'bot';
  channelId: Id | null;
  workItemId: Id | null;
  view: 'channel' | 'task' | 'inbox';
}

export const BOT_ROUTE_CHANNEL = 'baocut:bot-route';
export const BOT_TAKE_ROUTE_CHANNEL = 'baocut:bot-take-route';

export function taskRoute(channelId: Id, workItemId: Id): BotRoute {
  return { tab: 'bot', channelId, workItemId, view: 'task' };
}

export function channelRoute(channelId: Id): BotRoute {
  return { tab: 'bot', channelId, workItemId: null, view: 'channel' };
}

export const INBOX_ROUTE: BotRoute = { tab: 'bot', channelId: null, workItemId: null, view: 'inbox' };

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const VIEWS: ReadonlySet<string> = new Set(['channel', 'task', 'inbox']);

/** 只收认得的形状（ids 只认 id 的字符）；别的 null。 */
export function botRoute(raw: unknown): BotRoute | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (value.tab !== 'bot' || typeof value.view !== 'string' || !VIEWS.has(value.view)) return null;
  const id = (v: unknown): Id | null | undefined => (v === null ? null : typeof v === 'string' && ID.test(v) ? v : undefined);
  const channelId = id(value.channelId);
  const workItemId = id(value.workItemId);
  if (channelId === undefined || workItemId === undefined) return null;
  if (value.view === 'task' && (channelId === null || workItemId === null)) return null;
  if (value.view === 'channel' && channelId === null) return null;
  return { tab: 'bot', channelId, workItemId, view: value.view as BotRoute['view'] };
}

/** 等渲染进程来取的路由：只留最新的一条，取走即清。 */
export class PendingRoute {
  #route: BotRoute | null = null;

  set(route: BotRoute): void {
    this.#route = route;
  }

  take(): BotRoute | null {
    const route = this.#route;
    this.#route = null;
    return route;
  }
}
