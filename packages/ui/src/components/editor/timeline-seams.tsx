import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AssetRecord, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import {
  bandRestore,
  bandWordMarks,
  cutBands,
  cutText,
  dragBandEdge,
  retimeOperations,
  type BandDrag,
  type CutBand,
} from '../../model/cut-bands.ts';
import { readSpeechWords, type SpeechWord } from '../../model/speech-cues.ts';
import { spanIndex, spansIn } from '../../model/timeline-window.ts';
import { cutSetRecord, readCutSet, type TrackedCut } from '../../model/transcript-cut.ts';
import { CUT_BAND_COPY as C } from './cut-band-copy.ts';
import { useEditorActions } from './editor-context.tsx';
import { useDocumentBody } from './use-document-body.ts';
import { mediaCandidates } from './transcribe-run.ts';
import { applyRestore, applyRetime } from './transcript-actions.ts';
import { TRANSCRIPT_COPY } from './transcript-copy.ts';

/**
 * 时间线上的剪口带（原型 timeline-cutbands.jsx）：剪口是全局的，像播放头一样贯穿所有轨道，一处剪口一条带
 * （视频与链接的音频在同一处的剪口并成一条）。悬停说剪掉了什么、多长；点一下恢复；拖两缘改剪切范围。
 *
 * 时间线是成片，剪掉的内容不占时间，所以带不按剪掉的原长度画宽（那样会盖住留下的内容），在剪口上画一条
 * 固定宽的斜纹带。拖缘时带按「新区间」伸缩：多剪的那截正好盖住要剪掉的画面，少剪时按比例收窄，收到零宽就是恢复。
 * 拖动的口径（吸词边界、Alt 自由、夹取）与生成的事务在 model/cut-bands.ts。
 */

/** 静止时带宽（像素）。 */
const REST_W = 16;
/** 两缘命中区宽（压在带内侧；带窄时每侧缩到带宽的三分之一，中间留给点击恢复）。 */
const EDGE_PX = 6;
/** 按下后移动超过这么多像素才算拖。 */
const DRAG_PX = 3;
const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const NO_WORDS: SpeechWord[] = [];
const NO_CUTS: TrackedCut[] = [];

const bandStyle = style({
  position: 'absolute',
  zIndex: 1,
  boxSizing: 'border-box',
  display: 'block',
  padding: 0,
  borderWidth: 0,
  borderRadius: 'none',
  overflow: 'hidden',
  cursor: { default: 'pointer', isDisabled: 'default' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  // 斜纹、缝线与两缘的颜色在 editor.css（样式宏画不了渐变与内阴影），这里只给 token。
  '--bc-cut-bg': { type: 'backgroundColor', value: 'gray-100' },
  '--bc-cut-bg-hover': { type: 'backgroundColor', value: 'gray-200' },
  '--bc-cut-bg-drag': { type: 'backgroundColor', value: 'blue-100' },
  '--bc-cut-stripe': { type: 'backgroundColor', value: 'gray-300' },
  '--bc-cut-seam': { type: 'backgroundColor', value: 'gray-800' },
  '--bc-cut-edge': { type: 'backgroundColor', value: 'blue-400' },
  '--bc-cut-edge-line': { type: 'backgroundColor', value: 'blue-900' },
});
const tagStyle = style({
  position: 'absolute',
  zIndex: 5,
  font: 'code-xs',
  color: 'gray-25',
  backgroundColor: 'blue-900',
  borderRadius: 'sm',
  paddingX: 4,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
});
const tipLine = style({ display: 'block' });

/**
 * 剪口带层：挂在时间线内容层里、所有轨道行之后。`xOfFrame` 是序列帧 → 内容层横坐标（含行头列），
 * `top` / `height` 是轨道区的上沿与总高。`frames` 是看得见的时间窗（序列帧，时间线已含左右余量）：只画窗里的带，
 * 正在拖缘与有焦点的带不管在不在窗里都留着（见 AssetBands）。
 */
export function CutBands({
  sequence,
  assets,
  documents,
  xOfFrame,
  top,
  height,
  pps,
  frames,
  editable,
}: {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
  xOfFrame(frame: number): number;
  top: number;
  height: number;
  pps: number;
  frames: { from: number; to: number };
  editable: boolean;
}) {
  const bands = useMemo(() => cutBands(sequence), [sequence]);
  const groups = useMemo(() => {
    const byAsset = new Map<Id, CutBand[]>();
    for (const band of bands) {
      const list = byAsset.get(band.assetId);
      if (list) list.push(band);
      else byAsset.set(band.assetId, [band]);
    }
    return byAsset;
  }, [bands]);
  // 每个素材取最新的那份转写（同文稿面板）：用来说剪掉了哪些字、拖缘时吸词边界。
  const speeches = useMemo(
    () => (groups.size ? new Map(mediaCandidates(sequence, assets, documents).map((candidate) => [candidate.asset.id, candidate.speech])) : null),
    [groups, sequence, assets, documents],
  );
  if (!groups.size) return null;
  const shared = { sequence, assets, xOfFrame, top, height, pps, editable };
  // 带以剪口为中心 REST_W 宽：窗口两边各放宽一条带的宽度。
  const slack = (REST_W / pps) * (sequence.fps.num / sequence.fps.den);
  return (
    <>
      {[...groups].map(([assetId, list]) => (
        <AssetBands
          key={assetId}
          bands={list}
          from={frames.from - slack}
          to={frames.to + slack}
          speech={speeches?.get(assetId) ?? undefined}
          cutSet={cutSetRecord(documents, assetId)}
          {...shared}
        />
      ))}
    </>
  );
}

interface BandProps {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  xOfFrame(frame: number): number;
  top: number;
  height: number;
  pps: number;
  editable: boolean;
}

function AssetBands({
  bands,
  from,
  to,
  speech,
  cutSet,
  ...props
}: BandProps & { bands: CutBand[]; from: number; to: number; speech: DocumentRecord | undefined; cutSet: DocumentRecord | undefined }) {
  const body = useDocumentBody(speech);
  const words = useMemo(() => (body === undefined ? NO_WORDS : (readSpeechWords(body)?.words ?? NO_WORDS)), [body]);
  // 素材的剪口集合：恢复与改范围按它找盖住接缝的剪口。
  const cutBody = useDocumentBody(cutSet);
  const cuts = useMemo(() => (cutBody === undefined ? NO_CUTS : (readCutSet(cutBody) ?? NO_CUTS)), [cutBody]);
  // 按剪口位置排好，只画窗里的带。钉住的带（按着拖缘、键盘焦点在它上面）照画：卸掉会拆掉拖动的监听（= 取消拖动）、丢掉焦点。
  // 最近钉过的那条（失焦、松开后也记着，直到别的带钉住）前后各一条也照画：焦点在滚出窗的带上时，Tab / Shift+Tab 走到的是
  // 紧挨着的那条，不会跳到窗里第一条、漏掉中间没挂上的。不随失焦放掉：失焦先于新带得到焦点，那时就卸掉邻带，焦点会落空。
  const index = useMemo(() => spanIndex(bands, (band) => ({ start: band.frame, end: band.frame })), [bands]);
  const position = useMemo(() => new Map(bands.map((band, i) => [band.key, i])), [bands]);
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const [recent, setRecent] = useState<string | null>(null);
  const hold = useCallback((key: string, on: boolean) => {
    if (on) setRecent(key);
    setHeld((current) => {
      if (current.has(key) === on) return current;
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const pinned: CutBand[] = [];
  for (const key of held) {
    const i = position.get(key);
    if (i !== undefined) pinned.push(bands[i]!);
  }
  const at = recent === null ? undefined : position.get(recent);
  if (at !== undefined) pinned.push(...bands.slice(Math.max(0, at - 1), at + 2));
  const shown = spansIn(index, from, to, pinned);
  return (
    <>
      {shown.map((band) => (
        <Band key={band.key} band={band} words={words} cuts={cuts} onHold={hold} {...props} />
      ))}
    </>
  );
}

function Band({
  band,
  words,
  cuts,
  sequence,
  assets,
  xOfFrame,
  top,
  height,
  pps,
  editable,
  onHold,
}: BandProps & {
  band: CutBand;
  words: readonly SpeechWord[];
  cuts: readonly TrackedCut[];
  /** 这条带要不要钉住（不随滚动出窗卸掉）。 */
  onHold(key: string, on: boolean): void;
}) {
  const actions = useEditorActions();
  const [drag, setDrag] = useState<BandDrag | null>(null);
  const [tip, setTip] = useState(false);
  // 进行中的拖动：卸载时拆掉 window 上的监听。
  const live = useRef<(() => void) | null>(null);
  useEffect(() => () => live.current?.(), []);
  // 按下拖缘（监听已挂上，还没拖出 DRAG_PX 时 `drag` 仍是 null）到松开、以及键盘焦点在带上时，请父层钉住这一条。
  const [grabbed, setGrabbed] = useState(false);
  const [focused, setFocused] = useState(false);
  const pinned = grabbed || focused;
  useEffect(() => {
    if (!pinned) return;
    onHold(band.key, true);
    return () => onHold(band.key, false);
  }, [pinned, band.key, onHold]);
  const fps = sequence.fps;
  const perSecond = fps.num / fps.den;
  const seconds = band.frames / perSecond;
  const text = useMemo(() => cutText(words, band.from, band.to), [words, band.from, band.to]);

  // 几何：静止时以剪口为中心 REST_W 宽。拖动中多剪的部分按时间线比例往外伸，原来剪掉的那段按比例收窄。
  const x = xOfFrame(band.frame);
  let left = x - REST_W / 2;
  let right = x + REST_W / 2;
  if (drag?.changed) {
    const ppf = pps / perSecond;
    const span = Math.max(1, band.frames);
    left = drag.start <= 0 ? left + drag.start * ppf : left + (REST_W * Math.min(drag.start, span)) / span;
    right = drag.end >= band.frames ? right + (drag.end - band.frames) * ppf : right - (REST_W * (band.frames - drag.end)) / span;
  }
  const width = Math.max(2, right - left);
  if (right - left < 2) left = (left + right) / 2 - 1;
  const edgeWidth = Math.max(2, Math.min(EDGE_PX, Math.floor(width / 3)));

  const begin = (event: ReactPointerEvent<HTMLSpanElement>, edge: 'start' | 'end') => {
    if (event.button !== 0) return;
    // 不让按下落到带本体（= 恢复）、片段或时间轴空白（= 清选中）上。
    event.preventDefault();
    event.stopPropagation();
    setTip(false);
    if (!editable || live.current) return;
    // 改范围先要能恢复这一处，还要这一处正好是剪口剪掉的：拖一个空的范围试一下。
    const probe = retimeOperations(sequence, assets, band, cuts, { start: 0, end: 0 });
    const marks = bandWordMarks(band, words, fps);
    const pressX = event.clientX;
    const root = document.documentElement;
    let started = false;
    let dx = 0;
    let free = false;
    let last: BandDrag | null = null;
    const update = () => {
      last = dragBandEdge(band, marks, edge, (dx / pps) * perSecond, free, fps);
      setDrag(last);
    };
    const detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', detach);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
      root.classList.remove('bc-col-resize');
      live.current = null;
      setDrag(null);
      setGrabbed(false);
    };
    const move = (ev: PointerEvent) => {
      // 在别的窗口里松开了：作废，不提交。
      if (ev.buttons === 0) return detach();
      dx = ev.clientX - pressX;
      free = ev.altKey;
      if (!started) {
        if (Math.abs(dx) <= DRAG_PX) return;
        started = true;
        if (probe && !probe.ok) {
          // 这一处恢复不了，改范围（先恢复再剪）也做不到：照实说为什么。
          ToastQueue.neutral(TRANSCRIPT_COPY.restoreRefused[probe.reason], { timeout: 6000 });
          return detach();
        }
        root.classList.add('bc-col-resize');
      }
      update();
    };
    const up = (ev: PointerEvent) => {
      // 松开的位置也算一次移动：快速拖动时最后一段可能只出现在 pointerup 里。
      if (started) {
        dx = ev.clientX - pressX;
        free = ev.altKey;
        update();
      }
      const done: BandDrag | null = started ? last : null;
      detach();
      if (done?.changed) void applyRetime(actions, retimeOperations(sequence, assets, band, cuts, done), fps, seconds);
    };
    // Esc 取消（先于编辑器自己的 Esc）；拖动中按下 / 松开 Alt 立刻换吸附方式。
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && ev.type === 'keydown') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        detach();
      } else if (ev.key === 'Alt' && started) {
        ev.preventDefault();
        free = ev.type === 'keydown';
        update();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', detach);
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', key, true);
    live.current = detach;
    setGrabbed(true);
  };

  const edgeEl = (edge: 'start' | 'end') => (
    <span
      className="bc-cut-edge"
      data-edge={edge}
      data-on={drag?.changed && drag.edge === edge ? '' : undefined}
      style={{ width: edgeWidth }}
      aria-hidden
      onPointerDown={(event) => begin(event, edge)}
    />
  );

  const changed = drag?.changed ? drag : null;
  const frames = changed ? changed.end - changed.start : 0;
  return (
    <>
      <TooltipTrigger delay={300} isOpen={tip && !drag} onOpenChange={setTip}>
        <RACButton
          className={(renderProps) => `${bandStyle(renderProps)} bc-cut-band`}
          style={{ left, width, top, height }}
          data-drag={changed ? '' : undefined}
          aria-label={C.label(seconds, text)}
          isDisabled={!editable}
          onFocusChange={setFocused}
          onPress={() => void applyRestore(actions, bandRestore(sequence, band, cuts))}>
          {editable ? edgeEl('start') : null}
          {editable ? edgeEl('end') : null}
        </RACButton>
        <Tooltip>
          <span className={tipLine}>{C.cut(seconds, text)}</span>
          {editable ? <span className={tipLine}>{C.hint(MAC)}</span> : null}
        </Tooltip>
      </TooltipTrigger>
      {changed ? (
        <span className={tagStyle} style={{ left: left + width / 2, top: top + 2, transform: 'translateX(-50%)' }}>
          {frames < 1 ? C.tagRestore : C.tag(frames / perSecond, changed.edge, changed.word?.text ?? null)}
        </span>
      ) : null}
    </>
  );
}
