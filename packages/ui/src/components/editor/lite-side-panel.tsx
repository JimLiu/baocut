import { useEffect, useRef } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatClock } from '../../model/format.ts';
import { liteLineAt, liteSegmentAt, type LiteSegment, type LiteSource } from '../../model/lite-segments.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { LITE_COPY as L } from './lite-copy.ts';
import { usePlaybackFollow } from './use-playback-follow.ts';

/** 侧栏固定宽（轻量编辑器设计 §3「侧栏」：360px，不拖宽；收起由舞台条的开关管）。 */
export const LITE_SIDE_WIDTH = 360;

const panel = style({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  boxSizing: 'border-box',
  width: LITE_SIDE_WIDTH,
  minHeight: 0,
  backgroundColor: 'gray-25',
  borderStartWidth: 1,
  borderTopWidth: 0,
  borderBottomWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const head = style({ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0, paddingX: 16, paddingTop: 12, paddingBottom: 8 });
const title = style({ font: 'title-sm', color: 'gray-900' });
const meta = style({ font: 'ui-xs', color: 'gray-600' });
const hint = style({ font: 'ui-xs', color: 'gray-700', margin: 0, paddingX: 16, paddingBottom: 8 });
const list = style({ flexGrow: 1, minHeight: 0, overflow: 'auto', paddingBottom: 16 });
const group = style({ display: 'flex', flexDirection: 'column' });
const reset = {
  borderStyle: 'none',
  textAlign: 'start',
  width: 'full',
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
} as const;
const segHead = style({
  ...reset,
  position: 'sticky',
  top: 0,
  zIndex: 1,
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  boxSizing: 'border-box',
  paddingX: 16,
  paddingY: 8,
  font: 'ui-sm',
  fontWeight: 'bold',
  color: { default: 'gray-800', isCurrent: 'blue-900' },
  backgroundColor: { default: 'gray-25', ':hover': 'gray-100' },
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const segIndex = style({ font: 'ui-xs', color: 'gray-600', flexShrink: 0 });
const segTitle = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const segRange = style({ font: 'ui-xs', color: 'gray-600', flexShrink: 0, fontWeight: 'normal' });
const lineRow = style({
  ...reset,
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  boxSizing: 'border-box',
  paddingX: 16,
  paddingY: 4,
  font: 'ui-sm',
  color: { default: 'gray-800', isCurrent: 'gray-900' },
  backgroundColor: { default: 'transparent', ':hover': 'gray-100', isCurrent: 'blue-100' },
});
const lineTime = style({ font: 'code-xs', color: 'gray-600', flexShrink: 0, paddingTop: 2 });
const lineText = style({ minWidth: 0, overflowWrap: 'anywhere' });
const emptySeg = style({ font: 'ui-xs', color: 'gray-600', margin: 0, paddingX: 16, paddingY: 4 });
const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  paddingX: 16,
  paddingY: 32,
  font: 'ui-sm',
  color: 'gray-700',
  textAlign: 'center',
});
const emptyHint = style({ font: 'ui-xs', color: 'gray-600' });

const SOURCE_LABEL: Record<LiteSource, () => string> = {
  chapter: () => L.sourceChapter,
  speech: () => L.sourceSpeech,
  whole: () => L.sourceWhole,
};
const SOURCE_HINT: Record<LiteSource, () => string | null> = {
  chapter: () => null,
  speech: () => L.sourceSpeechHint,
  whole: () => L.sourceWholeHint,
};

/**
 * 轻量视图的侧栏（轻量编辑器设计 §3「侧栏」、§4）：段落表加逐句。头部是分了几段、按什么分的；正文每段一个粘顶的段头
 * （序号、标题、起止，点了跳段首），下面是这段的句（时间加文本，点了跳到那一句）。当前句浅蓝底，播放中跟着滚
 * （`usePlaybackFollow`：手动滚开就停，点一句或重新播放恢复）。还没有转写时整栏是一句提示。
 * 章节表的脚本（motion-video §2.2）还没有落到数据里，这一版只有逐句，见设计 §11。
 */
export function LiteSidePanel({ segments }: { segments: readonly LiteSegment[] }) {
  const { seek } = useEditorActions();
  const playhead = useEditor((s) => s.playhead);
  const current = liteSegmentAt(segments, playhead);
  const line = current ? liteLineAt(current.lines, playhead) : null;
  const source: LiteSource = segments[0]?.source ?? 'whole';
  const hasLines = segments.some((s) => s.lines.length > 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const follow = usePlaybackFollow(scrollRef);
  const lineId = line?.id ?? null;
  useEffect(() => {
    if (!lineId || follow.off.current) return;
    rows.current.get(lineId)?.scrollIntoView({ block: 'nearest' });
  }, [lineId, follow]);
  const jump = (seconds: number) => {
    follow.resume();
    seek(seconds);
  };
  const hintText = SOURCE_HINT[source]();

  return (
    <aside className={panel} aria-label={L.side}>
      <header className={head}>
        <span className={title}>{L.side}</span>
        <span className={meta}>
          {L.segmentCount(segments.length)} · {SOURCE_LABEL[source]()}
        </span>
      </header>
      {hintText ? <p className={hint}>{hintText}</p> : null}
      <div ref={scrollRef} className={`${list} bc-scroll`}>
        {!hasLines ? (
          <div className={empty}>
            <span>{L.noLines}</span>
            <span className={emptyHint}>{L.noLinesHint}</span>
          </div>
        ) : (
          segments.map((segment) => {
            const isCurrent = segment === current;
            return (
              <section key={segment.id} className={group} aria-current={isCurrent ? 'true' : undefined}>
                <button type="button" className={segHead({ isCurrent })} onClick={() => jump(segment.start)}>
                  <span className={`${segIndex} bc-tabular`}>{segment.index + 1}</span>
                  <span className={segTitle}>{segment.title}</span>
                  <span className={`${segRange} bc-tabular`}>{L.range(formatClock(segment.start), formatClock(segment.end))}</span>
                </button>
                {segment.lines.length === 0 ? (
                  <p className={emptySeg}>{L.noLinesInSegment}</p>
                ) : (
                  segment.lines.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      ref={(element) => {
                        if (element) rows.current.set(l.id, element);
                        else rows.current.delete(l.id);
                      }}
                      className={lineRow({ isCurrent: l.id === lineId })}
                      aria-label={L.lineLabel(formatClock(l.start), l.text)}
                      aria-current={l.id === lineId ? 'true' : undefined}
                      onClick={() => jump(l.start)}
                    >
                      <span className={`${lineTime} bc-tabular`}>{formatClock(l.start)}</span>
                      <span className={lineText}>{l.text}</span>
                    </button>
                  ))
                )}
              </section>
            );
          })
        )}
      </div>
    </aside>
  );
}
