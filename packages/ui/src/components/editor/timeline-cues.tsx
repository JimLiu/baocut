import { useMemo, type ReactNode, type RefObject } from 'react';
import type { CaptionItem, DocumentRecord, Sequence } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { placedCues } from '../../model/caption-cues.ts';
import { readCaptions } from '../../render/captions.ts';
import { useDocumentBody } from './use-document-body.ts';
import { useVisibleLane } from './use-visible-lane.ts';

const cueLayer = style({ position: 'absolute', inset: 0, pointerEvents: 'none' });
const cueBlock = style({
  position: 'absolute',
  top: 4,
  bottom: 4,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: { default: 'purple-300', isSelected: 'purple-400' },
  font: 'ui-xs',
  color: 'purple-1100',
  overflow: 'hidden',
});
const cueText = style({ truncate: true, minWidth: 0 });

/** 句子块窄于这个宽度就不写字（同旧版网页时间线）。 */
const LABEL_MIN_PX = 45;
/** 相邻两句之间留的缝。 */
const GAP_PX = 2;

/**
 * 字幕片段里的句子（照旧版网页时间线）：一句一块，块里写句子的文字，窄了就只留色块。只画看得见的部分；
 * 文档还没取到或没有句子时画 `fallback`（片段名）。
 */
export function CaptionCues({
  item,
  sequence,
  record,
  clipLeft,
  xOf,
  scrollRef,
  head,
  selected,
  fallback,
}: {
  item: CaptionItem;
  sequence: Sequence;
  record: DocumentRecord | undefined;
  /** 片段左边在轨道内容里的位置。 */
  clipLeft: number;
  /** 序列时间（秒）→ 轨道内容里的横坐标。 */
  xOf(seconds: number): number;
  scrollRef: RefObject<HTMLDivElement | null>;
  head: number;
  selected: boolean;
  fallback: ReactNode;
}) {
  const body = useDocumentBody(record);
  const placed = useMemo(() => {
    const track = readCaptions(body);
    return track ? placedCues(item, sequence, track) : [];
  }, [body, item, sequence]);
  const visible = useVisibleLane(scrollRef, head);
  if (placed.length === 0) return <>{fallback}</>;

  return (
    <div className={cueLayer}>
      {placed.map((cue) => {
        const x0 = xOf(cue.start);
        const x1 = xOf(cue.end);
        if (x1 < visible.left || x0 > visible.right) return null;
        const width = Math.max(2, x1 - x0 - GAP_PX);
        return (
          <span key={cue.key} className={cueBlock({ isSelected: selected })} style={{ left: x0 - clipLeft, width }}>
            {width >= LABEL_MIN_PX ? <span className={cueText}>{cue.text}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
