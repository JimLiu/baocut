import { useEffect, useMemo, useState, type RefObject } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { formatTenths } from '../../model/format.ts';
import { bookmarkStamps, isOnFrame, markedFrames, stampTarget, type BookmarkStamp } from '../../model/markup.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useMarkup } from '../../state/markup-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { MARKUP_COPY as C } from './markup-copy.ts';

/** 两枚印章的圆心至少隔这么多像素，近了合成一枚（印章 16px 宽，留 4px 缝）。 */
const STAMP_GAP_PX = 20;

const stamp = style({
  position: 'absolute',
  top: '50%',
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  minWidth: { default: 12, isGroup: 16 },
  height: { default: 12, isGroup: 16 },
  paddingX: { default: 0, isGroup: 4 },
  borderRadius: 'full',
  borderWidth: 0,
  transform: 'translate(-50%, -50%)',
  backgroundColor: { default: 'red-900', isHovered: 'red-1000', isCurrent: 'red-1000' },
  boxShadow: { default: '[0 0 0 2px white]', isCurrent: '[0 0 0 2px white, 0 0 0 4px rgb(0 0 0 / 0.25)]' },
  color: 'white',
  font: 'ui-xs',
  fontWeight: 'bold',
  lineHeight: '[1]',
  cursor: 'pointer',
  userSelect: 'none',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});

/**
 * 时间线章节条上的标记帧印章（lite-editor §4.1「标记帧的书签」）：标注模式里画过标记的每一帧在整条上落一枚红色印章，点一下定位到那一帧
 * （标记只在那一帧 ±0.5 s 内显示，所以去的是标记的时刻，不是指针下的位置）。挤在一起的几帧合成一枚、写上帧数，点几下按先后轮一遍；
 * 要直接挑某一帧用工具条上的书签列表。播放头在某枚印章的帧上时那一枚加一圈。标记发出去、复制或下载走了，印章跟着标记一起没了。
 */
export function BookmarkStamps({ barRef, duration }: { barRef: RefObject<HTMLElement | null>; duration: number }) {
  const { seek } = useEditorActions();
  const annotating = useEditor((s) => s.annotating);
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const bound = useMarkup((s) => s.videoId);
  const marks = useMarkup((s) => s.markup.marks);
  const width = useWidth(barRef);
  const stamps = useMemo(() => bookmarkStamps(markedFrames(marks), duration * 1000, width, STAMP_GAP_PX), [marks, duration, width]);
  if (!annotating || !videoId || bound !== videoId || !width) return null;
  return (
    <>
      {stamps.map((s) => (
        <Stamp key={s.timeMs} stamp={s} onSeek={(ms) => seek(ms / 1000)} />
      ))}
    </>
  );
}

/** 一枚印章。播放头单独订阅：播放时只重画这一枚的「在这一帧上」。 */
function Stamp({ stamp: s, onSeek }: { stamp: BookmarkStamp; onSeek(ms: number): void }) {
  const isCurrent = useEditor((e) => {
    const nowMs = Math.round(e.playhead * 1000);
    return s.frames.some((f) => isOnFrame(f, nowMs));
  });
  const isGroup = s.frames.length > 1;
  return (
    // 章节条点哪定位到哪：印章的点击不再往上冒。
    <span onClick={(event) => event.stopPropagation()}>
      <RACButton
        className={({ isHovered, isFocusVisible }) => stamp({ isGroup, isCurrent, isHovered, isFocusVisible })}
        style={{ left: `${s.at * 100}%` }}
        aria-label={C.stampLabel(formatTenths(s.timeMs / 1000), s.frames.length)}
        data-bookmark-stamp
        onPress={() => onSeek(stampTarget(s, Math.round(useEditor.getState().playhead * 1000)))}
      >
        {isGroup ? s.frames.length : null}
      </RACButton>
    </span>
  );
}

/** 整条的宽度（像素）：挤不挤按它算。 */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? element.getBoundingClientRect().width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
