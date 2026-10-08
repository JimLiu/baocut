import { defineMessages } from '@baocut/protocol';
import { zhHans } from './sidebar-toggle.zh-Hans.ts';
import { zhHant } from './sidebar-toggle.zh-Hant.ts';
import { ja } from './sidebar-toggle.ja.ts';
import { ko } from './sidebar-toggle.ko.ts';
import { es } from './sidebar-toggle.es.ts';
import { fr } from './sidebar-toggle.fr.ts';
import { de } from './sidebar-toggle.de.ts';
import { nl } from './sidebar-toggle.nl.ts';
import { ptBR } from './sidebar-toggle.pt-BR.ts';
import { it } from './sidebar-toggle.it.ts';
import { ru } from './sidebar-toggle.ru.ts';
import { pl } from './sidebar-toggle.pl.ts';
import { tr } from './sidebar-toggle.tr.ts';
import { vi } from './sidebar-toggle.vi.ts';

/**
 * 页面侧栏的开合（产品设计 §2.5，原型 shell.jsx `Titlebar` 的开合钮与 `SideSlide`）。
 *
 * 标题栏的开合钮排在后退、前进之后；不画按下态，状态由图标（开着是贯通的竖缝，收起是一截短杆）和
 * 提示 / 读屏名称表达。
 */
export function sidebarToggleLabel(hidden: boolean): string {
  return hidden ? M.show : M.hide;
}

/** 开合钮的提示与读屏名称（译文在 `sidebar-toggle.<语言>.ts`）。 */
const en = { show: 'Show sidebar', hide: 'Hide sidebar' };
export type SidebarToggleMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 开合动画的时长与曲线：与 S2 `transition: 'default'`、原型的 `--ease` 同值。 */
export const SIDEBAR_SLIDE = { duration: 150, easing: 'cubic-bezier(0.45, 0, 0.4, 1)' } as const;

export interface SidebarSlide {
  /** 外层裁切宽度的起止（px）。 */
  from: number;
  to: number;
  /** 收起时停在 0，等动画结束再卸载；展开结束后回到侧栏自己的宽度。 */
  fill: 'none' | 'forwards';
}

/**
 * 一次开合要动的宽度。侧栏本身宽度不变，只动外层的裁切宽度：展开从 0 拉到侧栏宽，收起从当前宽收回 0。
 * 上一次开合还没动完（`running`）就反向时，从此刻的宽度（`now`）接着走，不跳回端点。
 * `full` 是取消动画后外层的自然宽度，也就是侧栏的宽度。
 */
export function sidebarSlide({ open, running, now, full }: { open: boolean; running: boolean; now: number; full: number }): SidebarSlide {
  if (open) return { from: running ? now : 0, to: full, fill: 'none' };
  return { from: now, to: 0, fill: 'forwards' };
}
