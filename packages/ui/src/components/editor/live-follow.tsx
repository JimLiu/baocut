import { useEffect, useRef, useState } from 'react';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };

/*
 * 转录中的实时列表共用的几件（原型 panels.jsx `LiveTranscript`、panel-subtitle.jsx 转录中的 EditView，ui.css `.liveskel`、
 * `.livejump`）：文稿面板的实时文稿与字幕面板的实时字幕卡同一条规矩——新的进来跟到最新，往上翻就停住、浮出「回到最新」；
 * 一条都还没有时画三张骨架卡加一句提示，不造假数据。
 */

/** 离底不到这么多像素算「在最新处」，跟随着往下滚。 */
const FOLLOW_SLACK = 24;

const skeleton = style({ display: 'flex', flexDirection: 'column', gap: 12 });
const skeletonRow = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '[6px]',
  paddingX: 8,
  paddingY: 8,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const skeletonHead = style({ width: 64, height: 12, borderRadius: 'sm', backgroundColor: 'gray-200' });
const skeletonLine = style({ height: 14, borderRadius: 'sm', backgroundColor: 'gray-100' });
const hintText = style({ font: 'ui-xs', color: 'gray-600', margin: 0, paddingX: 4 });
/** 「回到最新」（原型 `.livejump`）：往上翻停住跟随时浮在底部正中。 */
const jump = style({
  position: 'absolute',
  insetStart: '50%',
  bottom: 16,
  translateX: '-50%',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 32,
  paddingX: 12,
  borderWidth: 0,
  borderRadius: 'full',
  backgroundColor: 'gray-900',
  font: 'ui-sm',
  color: 'gray-25',
  fontWeight: 'bold',
  boxShadow: 'elevated',
  cursor: 'pointer',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});

/**
 * 跟着最新的一条往下滚：`count` 变了（新的一条进来）、面板改尺寸或布局晚一拍定下来时，跟随中就贴到底部；用户往上翻离开底部
 * 就停住，`toLatest` 回到底部并恢复跟随。`bodyRef` 挂在滚动的那一层上，`onScroll` 挂它的滚动事件。
 */
export function useFollowLatest(count: number) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow);
  followRef.current = follow;
  useEffect(() => {
    const element = bodyRef.current;
    if (element && follow) element.scrollTop = element.scrollHeight;
  }, [count, follow]);
  const some = count > 0;
  useEffect(() => {
    const element = bodyRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followRef.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [some]);
  const onScroll = () => {
    const element = bodyRef.current;
    if (!element) return;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_SLACK;
    if (atEnd !== follow) setFollow(atEnd);
  };
  const toLatest = () => {
    setFollow(true);
    const element = bodyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  };
  return { bodyRef, follow, onScroll, toLatest };
}

/** 还一条都没有：三张骨架卡加一句提示（不承诺几秒后出现，有的服务完成时才一起返回）。 */
export function LiveSkeleton({ hint }: { hint: string }) {
  return (
    <div className={skeleton}>
      {[0, 1, 2].map((i) => (
        <div key={i} className={skeletonRow} aria-hidden>
          <span className={skeletonHead} />
          <span className={skeletonLine} />
          <span className={skeletonLine} style={{ width: '62%' }} />
        </div>
      ))}
      <p className={hintText}>{hint}</p>
    </div>
  );
}

/** 停住跟随时浮在列表底部正中的「回到最新」；放在列表外层（定位上下文）里。 */
export function JumpToLatest({ label, onPress }: { label: string; onPress(): void }) {
  return (
    <button type="button" className={jump} onClick={onPress}>
      <ChevronDown />
      {label}
    </button>
  );
}
