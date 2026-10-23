import { useLayoutEffect, useRef, useState } from 'react';
import type { Sequence } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { ActionButton, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { STAGE_COPY } from '../../copy.ts';
import { isPanelled, type FramedVideo, type FramingHit } from '../../model/stage-framing.ts';
import { applyFramingToAll, framingPieces, shotSeconds, showsShotChip } from '../../model/stage-shots.ts';
import { useVideo } from '../../state/video-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { FramingInfo, PanelsInfo, framingHitText, freeFraming } from './framing-info.tsx';
import type { FrameRect } from './stage-objects.tsx';

/**
 * 按原片取景的小牌（原型 stage-framing.jsx 的 `FramingChip`，产品设计 §5.10「画面怎么取景」「改一支短视频」）：选中按原片取景的
 * 视频时挂在画面左下角的外面，写「按原片取景」，旁边一枚 ⓘ 弹出「为什么只能放大」与「改成自由摆放」；拖画面、缩到比铺满还小、
 * 放大到上限时，那一行临时换成一句说明（`hit`，`role="status"`），过一会儿收回。拖动中也留着：那句说明正是拖的时候要看的。
 * 它是按镜头分段的其中一段时，再写「这一段 · 第 X–Y 秒」（子视频时间线上的秒）与次要操作「套到整支」：只把这一段的放大倍数
 * 写到同一素材的每一段（各段仍对准各自的人），一笔事务，提示里可以撤销。挂在画面外面：画面上方是视频工具条，画面里面会挡住
 * 要对的人。带 `data-stage-editor`，舞台的点选与框选不接它上面的指针。
 * 分屏的片段（原型 stage-panels.jsx `PanelsChip`）写「分屏 · N 格」，ⓘ 弹出「分屏怎么改」，没有「套到整支」（在属性面板「版式」里）；
 * 一人段的「套到整支」跳过分屏段，计数也不算它们。
 */

const chip = style({
  position: 'absolute',
  zIndex: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  paddingStart: 8,
  paddingEnd: 4,
  minHeight: 32,
  borderRadius: 'default',
  backgroundColor: 'gray-25',
  boxShadow: 'elevated',
  font: 'ui-sm',
  color: 'gray-800',
  whiteSpace: 'nowrap',
  userSelect: 'none',
});
const mode = style({ fontWeight: 'medium', color: { default: 'gray-800', isHit: 'orange-1000' } });
const sep = style({ width: '[1px]', height: 16, marginX: 4, backgroundColor: 'gray-300' });

/** 小牌离画面下沿多远、离舞台下沿至少留多少（舞台像素）。 */
const GAP = 8;
const CHIP_H = 40;

/** 舞台的高与视频工具条（舞台像素；没有工具条时 null）。 */
interface Room {
  h: number;
  bar: { top: number; h: number } | null;
}

/**
 * 小牌的上沿：画面下沿外 8px，舞台放不下时贴着舞台底；视频工具条也翻到了画面下方、和小牌叠在一起时，小牌挪到工具条上面
 * （压在画面下沿上，总比把工具条盖住好）。
 */
function chipTop(frame: FrameRect, room: Room | null): number {
  const below = frame.top + frame.height + GAP;
  if (!room) return below;
  const top = Math.max(0, Math.min(below, room.h - CHIP_H));
  const bar = room.bar;
  if (!bar || bar.top < frame.top + frame.height / 2) return top;
  const overlaps = top < bar.top + bar.h && bar.top < top + CHIP_H;
  return overlaps ? Math.max(0, bar.top - CHIP_H) : top;
}

export function StageFramingChip({
  item,
  sequence,
  frame,
  hit,
}: {
  item: FramedVideo;
  sequence: Sequence;
  frame: FrameRect;
  hit: FramingHit | null;
}) {
  const actions = useEditorActions();
  const { apply, undo } = actions;
  const assets = useVideo((s) => s.video?.state?.video.assets);
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<Room | null>(null);
  // 量舞台高与视频工具条的位置：工具条贴着舞台顶放不下时也翻到画面下方，小牌要让开它。
  useLayoutEffect(() => {
    const node = ref.current;
    const area = node?.parentElement;
    if (!node || !area) return;
    const measure = () => {
      const bar = [...area.children].find((child): child is HTMLElement => child !== node && child.getAttribute('role') === 'toolbar');
      const next: Room = { h: area.clientHeight, bar: bar ? { top: bar.offsetTop, h: bar.offsetHeight } : null };
      setRoom((old) => (old && old.h === next.h && old.bar?.top === next.bar?.top && old.bar?.h === next.bar?.h ? old : next));
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(area);
    const moves = new MutationObserver(measure);
    // 工具条量完自己才落位（改 style），后挂上来的也要接住：看整个舞台叠加层的增删与 style 变化，没变就不重渲染。
    moves.observe(area, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    return () => {
      resize.disconnect();
      moves.disconnect();
    };
  }, []);

  const shot = showsShotChip(sequence, item);
  const split = isPanelled(item);
  const pieces = shot ? framingPieces(sequence, item).filter((piece) => !piece.panels?.length) : [];
  const { from, to } = shotSeconds(item, sequence);
  const top = chipTop(frame, room);

  const applyAll = () => {
    const operations = applyFramingToAll(sequence.id, item, pieces);
    const done = () => ToastQueue.positive(STAGE_COPY.appliedAll(pieces.length), { timeout: 5000 });
    if (!operations.length) return done();
    void apply(operations, EditLabel.applyFramingToAll()).then((receipt) => {
      if (!receipt) return;
      ToastQueue.positive(STAGE_COPY.appliedAll(pieces.length), {
        timeout: 5000,
        actionLabel: STAGE_COPY.undo,
        onAction: () => void undo({ transaction: receipt.transactionId }),
        shouldCloseOnAction: true,
      });
    });
  };

  return (
    <div ref={ref} className={chip} style={{ left: frame.left, top }} data-stage-editor data-framing-chip={item.id}>
      <span className={mode({ isHit: !!hit })} role="status">
        {hit ? framingHitText(hit) : split ? STAGE_COPY.panelsMode(item.panels!.length) : STAGE_COPY.framingMode}
      </span>
      {split ? (
        <PanelsInfo placement="top start" />
      ) : (
        <FramingInfo placement="top start" onFree={() => freeFraming(actions, sequence, item, assets)} />
      )}
      {shot ? (
        <>
          <i className={sep} />
          <span>{STAGE_COPY.shotPiece(from, to)}</span>
          {split || pieces.length < 2 ? null : (
            <TooltipTrigger placement="top">
              <ActionButton size="S" isQuiet onPress={applyAll}>
                {STAGE_COPY.applyAll}
              </ActionButton>
              <Tooltip>{STAGE_COPY.applyAllTip}</Tooltip>
            </TooltipTrigger>
          )}
        </>
      ) : null}
    </div>
  );
}
