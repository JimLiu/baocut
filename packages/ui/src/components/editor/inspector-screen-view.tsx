import type { ReactNode } from 'react';
import type { AssetRecord, DocumentRecord, Id, ScreenViewBody, ScreenZoom, VideoItem } from '@baocut/protocol';
import { ActionButton, Picker, PickerItem, Switch, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatClock } from '../../model/format.ts';
import {
  CAMERA_LAYOUTS,
  POINTER_SIZE_MAX,
  POINTER_SIZE_MIN,
  PRESENTATION_STYLES,
  ZOOM_MAX,
  ZOOM_MIN,
  cameraLayoutOf,
  cameraLayoutOps,
  contentClock,
  contentOffset,
  followChange,
  followValue,
  pointerChange,
  pointerMode,
  presentationOf,
  presentationOps,
  removeZoomChange,
  screenItems,
  ticksToSeconds,
  zoomChanges,
  zoomSeconds,
  type CameraLayout,
  type PresentationStyle,
} from '../../model/screen-view.ts';
import { useScreenViewSelection } from '../../state/screen-view-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { Card, DangerButton, Note, PRow, Sec, SecHead, Seg, SwitchCard, ValueRow } from './inspector-controls.tsx';
import type { ItemPageProps } from './inspector-sections.tsx';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';
import { SCREEN_VIEW_COPY as SV } from './screen-view-copy.ts';
import { useScreenView, type ScreenViewState } from './use-screen-view.ts';

/*
 * 检查器里编辑录制的几节（屏幕录制设计 §5「录完之后怎么编辑」）：选中屏幕实例时的「屏幕取景」（缩放区间、跟随、光标、
 * 重新生成）与「演示样式」，选中摄像头实例时的「摄像头布局」。都落在取景文档与实例已有的字段上。
 */

const list = style({ display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: 0, listStyleType: 'none' });
const zoomRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 'full',
  paddingX: 8,
  paddingY: 4,
  borderRadius: 'default',
  borderWidth: 0,
  font: 'ui-sm',
  color: 'gray-800',
  textAlign: 'start',
  cursor: 'default',
  backgroundColor: { default: 'transparent', isSelected: 'blue-200', isHovered: 'gray-100' },
});
const zoomName = style({ fontWeight: 'bold', flexShrink: 0 });
const zoomMeta = style({ flexGrow: 1, minWidth: 0, color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const zoomScale = style({ flexShrink: 0, color: 'gray-700' });
const picker = style({ flexGrow: 1, minWidth: 0 });
const switchRow = style({ display: 'flex', alignItems: 'center', minHeight: 32 });

const originLabel = (zoom: ScreenZoom) => (zoom.origin === 'manual' ? SV.zoomManual : zoom.edited ? SV.zoomEdited : SV.zoomAuto);
const scaleLabel = (scale: number) => `${Math.round(scale * 100) / 100}×`;

/** 屏幕实例：「屏幕取景」与「演示样式」。 */
export function ScreenViewSections(props: ItemPageProps<VideoItem> & { documents: Record<Id, DocumentRecord> }) {
  const { item, documents } = props;
  const documentId = item.screenView?.documentId;
  if (!documentId || !documents[documentId]) return null;
  return (
    <>
      <ScreenViewSection {...props} documentId={documentId} />
      <PresentationSection {...props} />
    </>
  );
}

function ScreenViewSection({
  item,
  sequence,
  documents,
  canChange,
  documentId,
}: ItemPageProps<VideoItem> & { documents: Record<Id, DocumentRecord>; documentId: Id }) {
  const state = useScreenView(documents, documentId);
  const { apply, seek } = useEditorActions();
  const selected = useScreenViewSelection((s) => (s.selected?.documentId === documentId ? s.selected.zoomId : null));
  const select = useScreenViewSelection((s) => s.select);
  const { view, recording } = state;
  if (!view) return null;
  const offset = contentOffset(view, recording, item.assetRef.id);
  const clocks = screenItems(sequence, documentId)
    .map((screen) => contentClock(screen, sequence, offset))
    .filter((clock) => clock !== null);
  const current = view.zooms.find((zoom) => zoom.id === selected) ?? null;
  // 列表里点一段：选中它，播放头跳到它在序列上第一次出现的地方。
  const pick = (zoom: ScreenZoom) => {
    select({ documentId, zoomId: zoom.id });
    const { t0 } = zoomSeconds(view, zoom);
    const at = clocks.map((clock) => clock.toSequence(t0)).find((time, n) => time >= clocks[n]!.start - 1e-6 && time < clocks[n]!.end);
    if (at !== undefined) seek(at);
  };
  return (
    <>
      <SecHead
        action={
          <TooltipTrigger>
            <ActionButton
              size="S"
              isQuiet
              isDisabled={!canChange}
              onPress={() => void apply([{ type: 'regenerateAutoZooms', documentId }])}>
              <Refresh />
              <Text>{SV.regenerate}</Text>
            </ActionButton>
            <Tooltip>{SV.regenerateTip}</Tooltip>
          </TooltipTrigger>
        }>
        {SV.section}
      </SecHead>
      <Sec>
        <Card title={SV.zooms}>
          {view.zooms.length ? (
            <ul className={list} aria-label={SV.zooms}>
              {view.zooms.map((zoom, n) => {
                const { t0, t1 } = zoomSeconds(view, zoom);
                return (
                  <li key={zoom.id}>
                    <ZoomButton isSelected={zoom.id === selected} onPress={() => pick(zoom)}>
                      <span className={zoomName}>{SV.zoomName(n + 1)}</span>
                      <span className={zoomMeta}>
                        {formatClock(Math.max(0, t0 - offset), { tenths: true })} – {formatClock(Math.max(0, t1 - offset), { tenths: true })} · {originLabel(zoom)}
                      </span>
                      <span className={zoomScale}>{scaleLabel(zoom.scale)}</span>
                    </ZoomButton>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Note>{SV.zoomsEmpty}</Note>
          )}
          {current ? <ZoomEditor key={current.id} state={state} view={view} zoom={current} canChange={canChange} onDeleted={() => select(null)} /> : null}
        </Card>
        <Card title={SV.follow}>
          <ValueRow
            label={SV.safeArea}
            value={Math.round(followValue(view, 'safeArea') * 100)}
            min={0}
            max={95}
            unit="%"
            isDisabled={!canChange}
            onCommit={(v) => state.patch([followChange(view, 'safeArea', v / 100)])}
          />
          <ValueRow
            label={SV.smoothing}
            value={Math.round(followValue(view, 'smoothing') * 100)}
            min={0}
            max={100}
            unit="%"
            isDisabled={!canChange}
            onCommit={(v) => state.patch([followChange(view, 'smoothing', v / 100)])}
          />
        </Card>
        <CursorCard state={state} view={view} canChange={canChange} />
      </Sec>
    </>
  );
}

function ZoomButton({ isSelected, onPress, children }: { isSelected: boolean; onPress(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      className={zoomRow({ isSelected })}
      onClick={onPress}>
      {children}
    </button>
  );
}

/** 选中的那段缩放：倍率、看哪里、过渡长短、删除。 */
function ZoomEditor({
  state,
  view,
  zoom,
  canChange,
  onDeleted,
}: {
  state: ScreenViewState;
  view: ScreenViewBody;
  zoom: ScreenZoom;
  canChange: boolean;
  onDeleted(): void;
}) {
  const change = (patch: Parameters<typeof zoomChanges>[2]) => state.patch(zoomChanges(view, zoom.id, patch));
  const ramp = (value: string | undefined) => (value === undefined ? 0 : ticksToSeconds(value, view.timescale));
  return (
    <>
      <ValueRow
        label={SV.amount}
        value={zoom.scale}
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={0.1}
        digits={2}
        unit="×"
        isDisabled={!canChange}
        onCommit={(scale) => change({ scale })}
      />
      <PRow label={SV.focus}>
        <Seg<'pointer' | 'point'>
          label={SV.focus}
          value={zoom.focus.kind}
          options={[
            { key: 'pointer', label: SV.focusPointer },
            { key: 'point', label: SV.focusPoint },
          ]}
          isDisabled={!canChange}
          onChange={(kind) => change({ focus: kind === 'pointer' ? { kind: 'pointer' } : { kind: 'point', x: 0.5, y: 0.5 } })}
        />
      </PRow>
      {zoom.focus.kind === 'point' ? <Note>{SV.focusPointNote}</Note> : null}
      <ValueRow
        label={SV.rampIn}
        value={ramp(zoom.rampIn)}
        min={0}
        max={2}
        step={0.1}
        digits={1}
        unit={IC.seconds}
        isDisabled={!canChange}
        onCommit={(v) => change({ rampIn: v > 0 ? v : null })}
      />
      <ValueRow
        label={SV.rampOut}
        value={ramp(zoom.rampOut)}
        min={0}
        max={2}
        step={0.1}
        digits={1}
        unit={IC.seconds}
        isDisabled={!canChange}
        onCommit={(v) => change({ rampOut: v > 0 ? v : null })}
      />
      <DangerButton
        isDisabled={!canChange}
        onPress={() => {
          state.patch([removeZoomChange(zoom.id)]);
          onDeleted();
        }}>
        {SV.deleteZoom}
      </DangerButton>
    </>
  );
}

/** 光标一组：只有另画的光标能改；录进了画面（`baked`）或没有光标时整组置灰并说明。 */
function CursorCard({ state, view, canChange }: { state: ScreenViewState; view: ScreenViewBody; canChange: boolean }) {
  const mode = pointerMode(state.recording);
  const pointer = view.pointer ?? {};
  const able = canChange && mode === 'separate';
  const idle = pointer.idleHide ? ticksToSeconds(pointer.idleHide, view.timescale) : 0;
  const note = mode === 'baked' ? SV.cursorBaked : mode === 'none' ? SV.cursorNone : null;
  return (
    <>
      <SwitchCard
        title={SV.cursor}
        isOn={mode === 'separate' ? !pointer.hidden : false}
        isDisabled={!able}
        onToggle={(on) => state.patch([pointerChange(view, 'hidden', on ? null : true)])}>
        <ValueRow
          label={SV.cursorSize}
          value={Math.round((pointer.size ?? 1) * 100)}
          min={POINTER_SIZE_MIN * 100}
          max={400}
          hardMax={POINTER_SIZE_MAX * 100}
          step={5}
          unit="%"
          isDisabled={!able}
          onCommit={(v) => state.patch([pointerChange(view, 'size', v === 100 ? null : v / 100)])}
        />
        <ValueRow
          label={SV.smoothing}
          value={Math.round((pointer.smoothing ?? 0) * 100)}
          min={0}
          max={100}
          unit="%"
          isDisabled={!able}
          onCommit={(v) => state.patch([pointerChange(view, 'smoothing', v === 0 ? null : v / 100)])}
        />
        <ValueRow
          label={SV.idleHide}
          value={idle}
          min={0}
          max={10}
          step={0.5}
          digits={1}
          unit={IC.seconds}
          isDisabled={!able}
          onCommit={(v) => state.patch([pointerChange(view, 'idleHide', v > 0 ? String(Math.round(v * view.timescale)) : null)])}
        />
        <div className={switchRow}>
          <Switch
            size="S"
            isSelected={!!pointer.click}
            isDisabled={!able}
            onChange={(on) => state.patch([pointerChange(view, 'click', on ? { effect: 'ripple' } : null)])}>
            {SV.clickRipple}
          </Switch>
        </div>
      </SwitchCard>
      {/* 关着的开关卡不显示内容，说明放在卡片下面。 */}
      {note ? <Note>{note}</Note> : null}
    </>
  );
}

function PresentationSection({ item, sequence, canChange }: ItemPageProps<VideoItem>) {
  const { apply } = useEditorActions();
  return (
    <>
      <SecHead>{SV.presentation}</SecHead>
      <Sec>
        <PRow label={SV.presentation}>
          <Seg<PresentationStyle>
            label={SV.presentation}
            value={presentationOf(item)}
            options={PRESENTATION_STYLES.map((key) => ({ key, label: key === 'full' ? SV.presentationFull : SV.presentationInset }))}
            isDisabled={!canChange}
            onChange={(key) => void apply(presentationOps(key, sequence, item))}
          />
        </PRow>
        <Note>{SV.presentationNote}</Note>
      </Sec>
    </>
  );
}

const LAYOUT_LABEL: Record<CameraLayout, () => string> = {
  'corner-circle': () => SV.layoutCornerCircle,
  'corner-rounded': () => SV.layoutCornerRounded,
  split: () => SV.layoutSplit,
  'camera-full': () => SV.layoutCameraFull,
  hidden: () => SV.layoutHidden,
};

/** 摄像头实例：布局预设。左右分屏同时摆好同一组里的屏幕实例。 */
export function CameraLayoutSection({ item, sequence, assets, canChange }: ItemPageProps<VideoItem> & { assets: Record<Id, AssetRecord> }) {
  const { apply } = useEditorActions();
  const current = cameraLayoutOf(item);
  const revision = assets[item.assetRef.id]?.revisions[item.assetRef.revision];
  const source = { width: revision?.video?.displayWidth ?? 0, height: revision?.video?.displayHeight ?? 0 };
  const screens = sequence.items.filter(
    (other): other is VideoItem => other.type === 'video' && !!other.screenView && !!item.linkGroupId && other.linkGroupId === item.linkGroupId,
  );
  return (
    <>
      <SecHead>{SV.cameraLayout}</SecHead>
      <Sec>
        <PRow label={SV.cameraLayout}>
          <Picker
            aria-label={SV.cameraLayout}
            size="S"
            styles={picker}
            placeholder={SV.layoutCustom}
            selectedKey={current}
            isDisabled={!canChange}
            onSelectionChange={(key) => {
              if (key === null || key === current) return;
              void apply(cameraLayoutOps(key as CameraLayout, sequence, item, source, screens));
            }}>
            {CAMERA_LAYOUTS.map((key) => (
              <PickerItem key={key} id={key}>
                {LAYOUT_LABEL[key]()}
              </PickerItem>
            ))}
          </Picker>
        </PRow>
        <Note>{SV.cameraLayoutNote}</Note>
      </Sec>
    </>
  );
}

