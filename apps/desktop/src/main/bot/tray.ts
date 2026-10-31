import type { BotStatus } from '@baocut/protocol';
import { B } from './bot-copy.ts';

/**
 * 托盘 / 菜单栏（技术方案 §15.2，需求 §11.8）：显示后台服务在跑，角标是等你的任务数；菜单里「打开 BaoCut」「正在工作的任务（n）」
 * 「暂停全部自动运行 / 恢复自动运行」「退出后台服务」。
 *
 * 只管菜单内容与状态；真正的 Electron `Tray` / `Menu` 在 `TrayHost` 后面（`electron-host.ts`），测试用假的。
 * 角标：macOS 用 `setTitle`（菜单栏图标旁的数字）；Windows 的托盘图标没有叠加图标，数字放进提示文字；Linux 同 Windows。
 */

export interface TrayMenuItem {
  label?: string;
  type?: 'normal' | 'separator' | 'submenu';
  enabled?: boolean;
  click?: () => void;
  submenu?: TrayMenuItem[];
}

export interface TrayHost {
  setMenu(items: TrayMenuItem[]): void;
  /** macOS 菜单栏图标旁的文字；别的平台不调。 */
  setTitle(title: string): void;
  setToolTip(text: string): void;
  /** 点托盘图标本身（Windows / Linux 习惯单击打开窗口）。 */
  onClick(listener: () => void): void;
  destroy(): void;
}

export interface TrayActions {
  openWindow(): void;
  openTask(task: BotStatus['workingThreads'][number]): void;
  setPaused(paused: boolean): void;
  quitService(): void;
}

export interface TrayState {
  needsYou: number;
  working: BotStatus['workingThreads'];
  paused: boolean;
}

/** 子菜单里最多列几个任务；任务标题截短。 */
const WORKING_SHOWN = 10;
const TITLE_CHARS = 60;

export class TrayController {
  readonly #createHost: () => TrayHost;
  readonly #actions: TrayActions;
  readonly #platform: NodeJS.Platform;
  #host: TrayHost | null = null;
  #state: TrayState = { needsYou: 0, working: [], paused: false };

  constructor(createHost: () => TrayHost, actions: TrayActions, platform: NodeJS.Platform) {
    this.#createHost = createHost;
    this.#actions = actions;
    this.#platform = platform;
  }

  get visible(): boolean {
    return this.#host !== null;
  }

  get state(): Readonly<TrayState> {
    return this.#state;
  }

  show(): void {
    if (this.#host) return;
    const host = this.#createHost();
    this.#host = host;
    if (this.#platform !== 'darwin') host.onClick(() => this.#actions.openWindow());
    this.render();
  }

  hide(): void {
    this.#host?.destroy();
    this.#host = null;
  }

  update(patch: Partial<TrayState>): void {
    this.#state = { ...this.#state, ...patch };
    this.render();
  }

  /** 按当前语言与状态重画（界面换语言时也调）。 */
  render(): void {
    const host = this.#host;
    if (!host) return;
    const { needsYou, paused } = this.#state;
    host.setMenu(this.menu());
    if (this.#platform === 'darwin') host.setTitle(needsYou > 0 ? String(needsYou) : '');
    host.setToolTip(needsYou > 0 ? B.trayTooltipNeedsYou(needsYou) : paused ? B.trayTooltipPaused : B.trayTooltip);
  }

  menu(): TrayMenuItem[] {
    const { working, paused } = this.#state;
    const tasks: TrayMenuItem[] = working.length
      ? working.slice(0, WORKING_SHOWN).map((task) => ({ label: clip(task.title), click: () => this.#actions.openTask(task) }))
      : [{ label: B.trayNoWorking, enabled: false }];
    if (working.length > WORKING_SHOWN) tasks.push({ label: B.more(working.length - WORKING_SHOWN), enabled: false });
    return [
      { label: B.trayOpen, click: () => this.#actions.openWindow() },
      { type: 'submenu', label: B.trayWorking(working.length), submenu: tasks },
      { type: 'separator' },
      paused
        ? { label: B.trayResume, click: () => this.#actions.setPaused(false) }
        : { label: B.trayPause, click: () => this.#actions.setPaused(true) },
      { type: 'separator' },
      { label: B.trayQuit, click: () => this.#actions.quitService() },
    ];
  }
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > TITLE_CHARS ? `${flat.slice(0, TITLE_CHARS - 1)}…` : flat;
}
