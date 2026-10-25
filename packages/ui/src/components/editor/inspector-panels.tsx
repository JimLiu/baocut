import {
  FOCAL_MAX_ZOOM,
  PANEL_GAP_MAX,
  focalZoom,
  type EditOperation,
  type Localized,
  type PanelLayout,
  type Sequence,
} from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { ActionButton, Button, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { STAGE_COPY } from '../../copy.ts';
import { rootSequence } from '../../model/editor.ts';
import {
  applyPanelsToAll,
  hasPanels,
  layoutOfPanels,
  layoutsForPanels,
  panelSource,
  panelsInLayout,
  panelsOperations,
  singleOperations,
  soloOperations,
  splitOperations,
  swapPanels,
  swapPanelViews,
  upscaledPanels,
  withPanelFocal,
  type PanelledVideo,
} from '../../model/panels.ts';
import type { FramedVideo } from '../../model/stage-framing.ts';
import type { Assets } from '../../model/stage-pose.ts';
import { framingPieces } from '../../model/stage-shots.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { useEditorActions, type EditorActions } from './editor-context.tsx';
import { PanelsInfo, panelNames } from './framing-info.tsx';
import { Note, PRow, Sec, SecHead, Seg, ValueRow } from './inspector-controls.tsx';
import type { ItemEdit } from './use-item-edit.ts';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

/**
 * 「版式」（原型 stage-panels.jsx 的 `PanelsSection` / `PanelsLayoutRow`，短视频分屏设计 §8.4）：分屏的片段顶替「取景」段，
 * 一人 / 分屏切换，三格时「格子」（三行 / 上一下二），认得出版式时「间距」，每格一组「放大、左右位置、上下位置」，两格时
 * 「互换上下」，上一下二时下面两格各一项「放到上格」，每格「只留这一格的人」，有同格数的分屏段时「套到整支」。一人段的「取景」段
 * 里也有同一行「版式」，切成分屏用默认的两格。拖滑杆只叠草稿（间距每次都从视频里存着的格子换算），松手按视频里的实际值比出
 * 变了的格子再提交；切版式、换格子、互换、放到上格、只留一人、套到整支各是一笔事务，提示里可以撤销。
 */

const cell = style({ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 });
const cellHead = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 });
const cellName = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-800' });
const cellWarn = style({ font: 'ui-xs', color: 'orange-1000' });
const acts = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 8 });

type Layout = 'single' | 'split';

const LAYOUTS: readonly { key: Layout; label: string }[] = [
  {
    key: 'single',
    get label() {
      return IC.layoutSingle;
    },
  },
  {
    key: 'split',
    get label() {
      return IC.layoutSplit;
    },
  },
];

/** 视频里存着的那一份（属性页拿到的是叠了草稿的片段，比较要用实际值）。 */
function storedVideo<T extends FramedVideo>(item: T): T {
  const snapshot = useVideo.getState().video?.state?.video;
  const stored = (snapshot ? rootSequence(snapshot) : null)?.items.find((other) => other.id === item.id);
  return stored && stored.type === 'video' ? (stored as T) : item;
}

/** 提交一笔版式修改，成功后提示一句（带撤销）；什么都没变就收掉草稿。 */
function commitLayout(
  actions: Pick<EditorActions, 'apply' | 'undo'>,
  operations: EditOperation[],
  label: Localized,
  message: string,
): void {
  if (!operations.length) return useEditor.getState().clearDrafts();
  void actions.apply(operations, label).then((receipt) => {
    if (!receipt) return useEditor.getState().clearDrafts();
    ToastQueue.positive(message, {
      timeout: 5000,
      actionLabel: STAGE_COPY.undo,
      onAction: () => void actions.undo({ transaction: receipt.transactionId }),
      shouldCloseOnAction: true,
    });
  });
}

/** 一人段「取景」段里的「版式」一行：切成分屏用默认的两格（上格取原片左半、下格取右半），之后在格子里调。 */
export function LayoutRow({ item, sequence, isDisabled }: { item: FramedVideo; sequence: Sequence; isDisabled: boolean }) {
  const actions = useEditorActions();
  return (
    <PRow label={IC.layout}>
      <Seg<Layout>
        label={IC.layout}
        value="single"
        options={LAYOUTS}
        isDisabled={isDisabled}
        onChange={(key) => {
          if (key === 'split')
            commitLayout(actions, splitOperations(sequence.id, storedVideo(item)), EditLabel.changeLayout(), IC.panelsToSplit);
        }}
      />
    </PRow>
  );
}

export function PanelsSection({
  item,
  sequence,
  assets,
  edit,
  isDisabled,
}: {
  item: PanelledVideo;
  sequence: Sequence;
  assets?: Assets;
  edit: ItemEdit;
  isDisabled: boolean;
}) {
  const actions = useEditorActions();
  const { panels } = item;
  const canvas = sequence.canvas;
  const lay = layoutOfPanels(panels, canvas);
  const layouts = layoutsForPanels(panels.length);
  const names = panelNames(panels.length, lay?.layout);
  const source = panelSource(item, assets);
  const soft = upscaledPanels(panels, source, canvas);
  const others = framingPieces(sequence, item).filter(
    (piece) => piece.id !== item.id && hasPanels(piece) && piece.panels.length === panels.length,
  );
  /** 视频里存着的分屏格子；别处刚把它换回一人时用叠了草稿的这一份。 */
  const stored = (): PanelledVideo => {
    const base = storedVideo(item);
    return hasPanels(base) ? base : item;
  };

  const commitFocal = (index: number, patch: { x?: number; y?: number; zoom?: number }) => {
    const base = stored();
    const operations = panelsOperations(sequence.id, base, withPanelFocal(base.panels, index, patch));
    if (operations.length) edit.commit(operations, EditLabel.adjustPanel());
    else useEditor.getState().clearDrafts();
  };
  const live = (index: number, patch: { x?: number; y?: number; zoom?: number }) =>
    edit.live({ panels: withPanelFocal(panels, index, patch) });

  const setLayout = (layout: PanelLayout) => {
    const base = stored();
    const from = layoutOfPanels(base.panels, canvas);
    if (!from || from.layout === layout) return;
    const next = panelsInLayout(base.panels, layout, from.gap, panelSource(base, assets), canvas);
    const message = layout === 'spotlight' ? IC.panelLayoutSpotlight : IC.panelLayoutRows;
    commitLayout(actions, panelsOperations(sequence.id, base, next), EditLabel.changeLayout(), message);
  };
  /** 改间距：每次都从视频里存着的格子换算，夹在 1–4 倍里的放大不会越拖越偏。 */
  const gapPanels = (gap: number) => {
    const base = stored();
    const from = layoutOfPanels(base.panels, canvas);
    return from ? panelsInLayout(base.panels, from.layout, gap, panelSource(base, assets), canvas) : null;
  };
  const liveGap = (gap: number) => {
    const next = gapPanels(gap);
    if (next) edit.live({ panels: next });
  };
  const commitGap = (gap: number) => {
    const next = gapPanels(gap);
    const operations = next ? panelsOperations(sequence.id, stored(), next) : [];
    if (operations.length) edit.commit(operations, EditLabel.adjustPanel());
    else useEditor.getState().clearDrafts();
  };
  const toTop = (index: number) => {
    const base = stored();
    const src = panelSource(base, assets);
    if (!src) return;
    commitLayout(
      actions,
      panelsOperations(sequence.id, base, swapPanelViews(base.panels, 0, index, src, canvas)),
      EditLabel.changeLayout(),
      IC.panelsMovedTop(names[index]!),
    );
  };
  const toSingle = () =>
    commitLayout(
      actions,
      singleOperations(sequence.id, stored(), panelSource(stored(), assets), canvas),
      EditLabel.changeLayout(),
      IC.panelsToSingle,
    );
  const swap = () => {
    const base = stored();
    commitLayout(actions, panelsOperations(sequence.id, base, swapPanels(base.panels)), EditLabel.changeLayout(), IC.panelsSwapped);
  };
  const solo = (index: number) => {
    const base = stored();
    commitLayout(
      actions,
      soloOperations(sequence.id, base, index, panelSource(base, assets), canvas),
      EditLabel.changeLayout(),
      IC.panelsSoloed(names[index]!),
    );
  };
  const applyAll = () => {
    const { operations, count } = applyPanelsToAll(sequence.id, stored(), others);
    if (!operations.length) return void ToastQueue.positive(STAGE_COPY.panelsAppliedAll(count), { timeout: 5000 });
    commitLayout(actions, operations, EditLabel.applyFramingToAll(), STAGE_COPY.panelsAppliedAll(count));
  };

  return (
    <>
      <SecHead aside={STAGE_COPY.panelsMode(panels.length)} action={<PanelsInfo placement="bottom end" />}>
        {IC.layout}
      </SecHead>
      <Sec>
        <PRow label={IC.layout}>
          <Seg<Layout>
            label={IC.layout}
            value="split"
            options={LAYOUTS}
            isDisabled={isDisabled}
            onChange={(key) => {
              if (key === 'single') toSingle();
            }}
          />
        </PRow>
        {lay && layouts.length > 1 ? (
          <PRow label={IC.panelGrid}>
            <Seg<PanelLayout>
              label={IC.panelGrid}
              value={lay.layout}
              options={layouts.map((key) => ({ key, label: key === 'spotlight' ? IC.panelLayoutSpotlight : IC.panelLayoutRows }))}
              isDisabled={isDisabled}
              onChange={setLayout}
            />
          </PRow>
        ) : null}
        {lay ? (
          <ValueRow
            label={IC.panelGap}
            value={lay.gap}
            min={0}
            max={PANEL_GAP_MAX}
            step={0.5}
            digits={1}
            isDisabled={isDisabled}
            onLive={liveGap}
            onCommit={commitGap}
          />
        ) : null}
        {panels.map((panel, i) => (
          <div key={i} className={cell}>
            <div className={cellHead}>
              <span className={cellName}>{names[i]}</span>
              {soft[i] ? <span className={cellWarn}>{IC.panelUpscaled}</span> : null}
            </div>
            <ValueRow
              label={IC.framingZoom}
              value={Math.round(focalZoom(panel.focalPoint) * 100)}
              min={100}
              max={FOCAL_MAX_ZOOM * 100}
              unit="%"
              isDisabled={isDisabled}
              onLive={(value) => live(i, { zoom: value / 100 })}
              onCommit={(value) => commitFocal(i, { zoom: value / 100 })}
            />
            <ValueRow
              label={IC.panelX}
              value={Math.round(panel.focalPoint.x * 100)}
              min={0}
              max={100}
              isDisabled={isDisabled}
              onLive={(value) => live(i, { x: value / 100 })}
              onCommit={(value) => commitFocal(i, { x: value / 100 })}
            />
            <ValueRow
              label={IC.panelY}
              value={Math.round(panel.focalPoint.y * 100)}
              min={0}
              max={100}
              isDisabled={isDisabled}
              onLive={(value) => live(i, { y: value / 100 })}
              onCommit={(value) => commitFocal(i, { y: value / 100 })}
            />
          </div>
        ))}
        <div className={acts}>
          {panels.length === 2 ? (
            <Button variant="secondary" size="S" isDisabled={isDisabled} onPress={swap}>
              {IC.panelSwap}
            </Button>
          ) : null}
          {lay?.layout === 'spotlight' && source
            ? [1, 2].map((i) => (
                <Button key={`top-${i}`} variant="secondary" size="S" isDisabled={isDisabled} onPress={() => toTop(i)}>
                  {IC.panelToTop(names[i]!)}
                </Button>
              ))
            : null}
          {names.map((name, i) => (
            <Button key={i} variant="secondary" size="S" isDisabled={isDisabled} onPress={() => solo(i)}>
              {IC.panelSolo(name)}
            </Button>
          ))}
          {others.length ? (
            <TooltipTrigger placement="bottom">
              <ActionButton size="S" isQuiet isDisabled={isDisabled} onPress={applyAll}>
                {STAGE_COPY.applyAll}
              </ActionButton>
              <Tooltip>{STAGE_COPY.panelsApplyAllTip}</Tooltip>
            </TooltipTrigger>
          ) : null}
        </div>
        <Note>{STAGE_COPY.panelsHow}</Note>
      </Sec>
    </>
  );
}
