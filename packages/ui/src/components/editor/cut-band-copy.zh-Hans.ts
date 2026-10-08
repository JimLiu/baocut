import type { CutBandMessages } from './cut-band-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

/** 被剪文字太长时只引前面这么多字。 */
const QUOTE_MAX = 40;

const quote = (text: string) => `「${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}」`;

const cut = (seconds: number, text: string) => (text ? `剪掉了 ${secondsLabel(seconds)}：${quote(text)}` : `剪掉了 ${secondsLabel(seconds)}`);

export const zhHans: CutBandMessages = {
  /** 悬停第一行：剪掉了多长、剪掉的是哪些字。 */
  cut,
  /** 悬停第二行：怎么操作。按住 Alt（macOS 上是 Option）不吸附。 */
  hint: (mac: boolean) => `点一下恢复 · 拖两缘改范围（按住 ${mac ? 'Option' : 'Alt'} 不吸附）`,
  /** 读屏名。 */
  label: (seconds: number, text: string) => `剪口，${cut(seconds, text)}，点一下恢复`,
  /** 拖动中浮在带上的读数：新的剪切长度，吸到的词；拖到零宽是恢复。 */
  tag: (seconds: number, edge: 'start' | 'end', word: string | null) =>
    `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · 从「${word.trim()}」起` : ` · 到「${word.trim()}」止`) : ''}`,
  tagRestore: '松手恢复',
  /** 编辑事务的名字。 */
  retimeLabel: '改剪切范围',
  retimed: (before: number, after: number) => `已改剪切范围 · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};
