import * as loader from '@react-spectrum/ai/loader';
import type { Cell } from '@react-spectrum/ai/loader';
import { THINKING, forKind, type LoaderIcon } from '../../model/agent-loader.ts';

/** 名字 → 像素格。按类型核对：model/agent-loader.ts 里的每个名字都得是这个包导出的单个图形。 */
const TABLE: Record<LoaderIcon, Cell[]> = loader;

/** 加载图形的键：'thinking' 是通用序列，其余是步骤类别（model/agent-loader.ts 的 LoaderKind；认不出的走兜底）。 */
export type LoaderKey = 'thinking' | (string & {});

const SEQUENCES = new Map<string, Cell[][] | undefined>();
const ICONS = new Map<string, Cell[] | undefined>();

/**
 * 正在跑的那一步与回合页脚播的序列。按键缓存，数组引用稳定（PixelLoader 拿到新引用会从第一个图重播）；
 * 一个图都取不到时给 undefined，PixelLoader 用它的默认图形。
 */
export function loaderSequence(key: LoaderKey): Cell[][] | undefined {
  if (!SEQUENCES.has(key)) {
    const names = key === 'thinking' ? THINKING : forKind(key);
    const cells = names.map((name) => TABLE[name]).filter((c) => Array.isArray(c) && c.length > 0);
    SEQUENCES.set(key, cells.length ? cells : undefined);
  }
  return SEQUENCES.get(key);
}

/** 工作组标题前静止的单个图：序列里的第一个。 */
export function loaderIcon(key: LoaderKey): Cell[] | undefined {
  if (!ICONS.has(key)) ICONS.set(key, loaderSequence(key)?.[0]);
  return ICONS.get(key);
}
