import { useEffect, useState, type SyntheticEvent } from 'react';
import { Button, ProgressCircle } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useVideo } from '../../state/video-store.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';
import type { PreviewEngine, PreviewStatus } from './preview-engine.ts';
import { SPINNER_DELAY_MS, stallDetail, stallTopic, waitedSeconds } from './preview-stall.ts';
import type { StallReport } from './preview-watch.ts';

/**
 * 盖住整块画面、接住指针（设计稿 `.stageload`）：此刻画布上什么都没有，点在黑块上不能选中、框选底下看不见的元素。
 * 画面背后总是黑的，面板与卡也总是深色：不随明暗主题翻转。
 */
const layer = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  boxSizing: 'border-box',
  borderRadius: 'sm',
  backgroundColor: 'black',
  pointerEvents: 'auto',
  cursor: 'default',
});
const busy = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-sm', color: 'transparent-white-700' });
/** 与「主媒体放不出来」那张（stage-media-notice.tsx）同一个样子，多一行按钮。 */
const card = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 4,
  maxWidth: 440,
  paddingX: 16,
  paddingY: 12,
  borderRadius: 'lg',
  backgroundColor: 'transparent-white-100',
  // `font` 简写自带颜色，颜色要写在它后面。
  font: 'ui-sm',
  color: 'transparent-white-800',
  overflowWrap: 'anywhere',
});
const title = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'title-sm', color: 'white' });
const step = style({ color: 'transparent-white-900' });
const action = style({ marginTop: 4 });

/** 按下、点击、双击、右键都不再往上冒（舞台与编辑器的点选、清选）；卡上的「重试」先于这里处理，照常可点。 */
const swallow = (event: SyntheticEvent) => event.stopPropagation();
const block = { onPointerDown: swallow, onMouseDown: swallow, onClick: swallow, onDoubleClick: swallow, onContextMenu: swallow };

/**
 * 预览载入与卡住（产品设计 §5.1，设计稿 stage-load.jsx）：载入中是一块不透明的深色面板，满 `SPINNER_DELAY_MS` 才露出
 * 转圈；卡住（预览引擎的卡住诊断报出、页面可见）时画面正中一张卡，说卡在哪一步、已经等了几秒，带「重试」。
 * `suppressed`：主媒体放不出来已有专门的卡，不再叠一张。
 */
export function StageLoadNotice({
  engine,
  status,
  frame,
  suppressed,
  onRetry,
}: {
  engine: PreviewEngine;
  status: PreviewStatus;
  frame: { left: number; top: number; width: number; height: number };
  suppressed: boolean;
  onRetry(): void;
}) {
  const stall = usePreviewStall(engine);
  const loading = status.kind === 'loading';
  const spinner = useDelayed(loading, SPINNER_DELAY_MS);
  if (stall && !suppressed) return <StallCard stall={stall} frame={frame} onRetry={onRetry} />;
  if (!loading) return null;
  return (
    <div className={layer} style={frame} role="status" aria-label={E.stall.loading} data-preview-load="loading" {...block}>
      {spinner ? (
        <div className={busy}>
          <ProgressCircle size="S" isIndeterminate staticColor="white" aria-label={E.stall.loading} />
          <span>{E.stall.loading}</span>
        </div>
      ) : null}
    </div>
  );
}

function StallCard({ stall, frame, onRetry }: { stall: StallReport; frame: { left: number; top: number; width: number; height: number }; onRetry(): void }) {
  const video = useVideo((s) => s.video?.state?.video ?? null);
  const [now, setNow] = useState(() => performance.now());
  // 「已经等了 N 秒」逐秒更新。
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const detail = stallDetail(stall, {
    asset: (id) => video?.assets[id]?.name,
    document: (id) => video?.documents?.[id]?.name,
  });
  return (
    <div className={layer} style={frame} role="alert" data-preview-load="stalled" data-preview-stall={stallTopic(stall.step)} {...block}>
      <div className={card}>
        <div className={title}>
          <AlertTriangle styles={iconStyle({ size: 'S', color: 'notice' })} />
          {E.stall.title}
        </div>
        <div className={step}>{detail}</div>
        <div>{E.stall.body(waitedSeconds(stall, Math.max(now, stall.since + stall.stalledMs)))}</div>
        <div className={action}>
          <Button variant="secondary" staticColor="white" size="S" onPress={onRetry}>
            {E.retry}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 还卡着的那一段（预览引擎的卡住诊断）；页面隐藏时不显示（诊断回来之后重新计时）。 */
function usePreviewStall(engine: PreviewEngine): StallReport | null {
  const [stall, setStall] = useState<StallReport | null>(() => engine.stall);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => engine.onStall(setStall), [engine]);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible ? stall : null;
}

/** `on` 连续为真满 `ms` 之后才为真（快的载入不闪）。 */
function useDelayed(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!on) return;
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && late;
}
