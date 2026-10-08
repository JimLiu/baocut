import { useEffect, useState } from 'react';
import type { Sequence } from '@baocut/protocol';
import { ActionButton, Text, TextField, ToggleButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import FlipHorizontal from '@react-spectrum/s2/icons/FlipHorizontal';
import FlipVertical from '@react-spectrum/s2/icons/FlipVertical';
import Lock from '@react-spectrum/s2/icons/Lock';
import LockOpen from '@react-spectrum/s2/icons/LockOpen';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  PIN_NAMES,
  PIN_X,
  PIN_Y,
  X_LABEL,
  Y_LABEL,
  applyPanel,
  boxOf,
  defaultPin,
  fitCanvas,
  project,
  quick,
  wrapRotation,
  type BoxFields,
  type Pin,
  type PanelValues,
  type QuickAction,
} from '../../model/geometry-panel.ts';
import { placeFields, posable, poseOf, type Assets, type PlaceFields, type PlacedItem } from '../../model/stage-pose.ts';
import { PRow, Sec, SecHead, ValueRow } from './inspector-controls.tsx';
import type { ItemEdit } from './use-item-edit.ts';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

const geom = style({ display: 'flex', alignItems: 'start', gap: 12 });
const pinGrid = style({
  display: 'grid',
  flexShrink: 0,
  gridTemplateColumns: [16, 16, 16],
  gridTemplateRows: [16, 16, 16],
  gap: 4,
  marginTop: 20,
});
const pinCell = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  size: 16,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'sm',
  backgroundColor: { default: 'gray-100', isOn: 'blue-900', isDisabled: { default: 'gray-75', isOn: 'gray-300' } },
  cursor: { default: 'pointer', isDisabled: 'default' },
});
const pinDot = style({
  borderRadius: 'full',
  size: { default: 4, isOn: 6 },
  backgroundColor: { default: 'gray-500', isOn: 'gray-25' },
});
const fields = style({
  flexGrow: 1,
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: ['minmax(0, 1fr)', 'minmax(0, 1fr)', 24],
  gap: 8,
  alignItems: 'end',
});
const quickRow = style({ display: 'flex', flexWrap: 'wrap', gap: '[6px]' });

/** 钉点与锁比只在这次会话里记着（不落盘），按片段 ID。 */
const PINS = new Map<string, Pin>();
const LOCKS = new Map<string, boolean>();

/**
 * 几何段：九宫钉点、X / Y / W / H（画布百分比）、锁定比例、快捷动作（贴齐钉点 · 整宽 · 整高 · 适应画布 · 填满画布），
 * 下面是旋转与翻转。只在提交时换算回 `place`；铺满画布的片段框不看位置，只能转与翻转。
 */
export function GeometrySection({
  item,
  sequence,
  edit,
  assets,
  isDisabled,
}: {
  item: PlacedItem;
  sequence: Sequence;
  assets?: Assets;
  edit: ItemEdit;
  isDisabled: boolean;
}) {
  const [, bump] = useState(0);
  const canvas = sequence.canvas;
  const place = item.place;
  const pose = poseOf(item, canvas, assets);
  const fixed = isDisabled || !posable(item, canvas, assets);
  const box = boxOf(pose, canvas);
  if (!PINS.has(item.id)) PINS.set(item.id, defaultPin(box));
  const pin = PINS.get(item.id)!;
  const lock = LOCKS.get(item.id) ?? false;
  const values = project(box, pin);
  const target = { sequenceId: sequence.id, itemId: item.id };

  const write = (fields: PlaceFields & { flipX?: boolean; flipY?: boolean }) =>
    edit.commit([{ type: 'setTransform', ...target, ...fields }]);
  const writePose = (next: BoxFields) => {
    const fieldsNext = placeFields(item, { ...pose, ...next }, canvas, assets);
    if (Object.keys(fieldsNext).length) write(fieldsNext);
  };
  const commitValues = (p: Pin, next: PanelValues) => writePose(applyPanel(pose, canvas, p, next, lock));
  const setPin = (p: Pin) => {
    PINS.set(item.id, p);
    bump((n) => n + 1);
  };
  const runQuick = (action: QuickAction) => {
    const q = quick(pin, values, action);
    setPin(q.pin);
    commitValues(q.pin, q.values);
  };

  return (
    <>
      <SecHead>{IC.geometry}</SecHead>
      <Sec>
        <div className={geom}>
          <div className={pinGrid} role="radiogroup" aria-label={IC.anchor}>
            {PIN_Y.flatMap((y) =>
              PIN_X.map((x) => {
                const on = pin.x === x && pin.y === y;
                const name = PIN_NAMES[`${x} ${y}`];
                return (
                  <button
                    key={`${x} ${y}`}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={IC.measureFrom(name)}
                    title={IC.measureFrom(name)}
                    disabled={fixed}
                    className={pinCell({ isOn: on, isDisabled: fixed })}
                    onClick={() => setPin({ x, y })}>
                    <span className={pinDot({ isOn: on })} />
                  </button>
                );
              }),
            )}
          </div>
          <div className={fields}>
            <NumField label={X_LABEL[pin.x]} value={values.x} isDisabled={fixed} onCommit={(x) => commitValues(pin, { ...values, x })} />
            <NumField label={IC.width} value={values.w} isDisabled={fixed} onCommit={(w) => commitValues(pin, { ...values, w })} />
            <span />
            <NumField label={Y_LABEL[pin.y]} value={values.y} isDisabled={fixed} onCommit={(y) => commitValues(pin, { ...values, y })} />
            <NumField label={IC.height} value={values.h} isDisabled={fixed} onCommit={(h) => commitValues(pin, { ...values, h })} />
            <TooltipTrigger>
              <ToggleButton
                isQuiet
                size="S"
                aria-label={IC.lockRatio}
                isSelected={lock}
                isDisabled={fixed}
                onChange={(on) => {
                  LOCKS.set(item.id, on);
                  bump((n) => n + 1);
                }}>
                {lock ? <Lock /> : <LockOpen />}
              </ToggleButton>
              <Tooltip>{IC.lockRatio}</Tooltip>
            </TooltipTrigger>
          </div>
        </div>
        <div className={quickRow}>
          <ActionButton size="S" isDisabled={fixed} onPress={() => runQuick('snapToPin')}>
            {IC.snapToPin}
          </ActionButton>
          <ActionButton size="S" isDisabled={fixed} onPress={() => runQuick('fullWidth')}>
            {IC.fullWidth}
          </ActionButton>
          <ActionButton size="S" isDisabled={fixed} onPress={() => runQuick('fullHeight')}>
            {IC.fullHeight}
          </ActionButton>
          <ActionButton size="S" isDisabled={fixed} onPress={() => writePose(fitCanvas(pose, canvas, false))}>
            {IC.fitCanvas}
          </ActionButton>
          <ActionButton size="S" isDisabled={fixed} onPress={() => writePose(fitCanvas(pose, canvas, true))}>
            {IC.fillCanvas}
          </ActionButton>
        </div>
        <ValueRow
          label={IC.rotation}
          value={place.rot ?? 0}
          min={-180}
          max={180}
          digits={1}
          unit="°"
          normalize={wrapRotation}
          isDisabled={isDisabled}
          onLive={(rot) => edit.live({ place: { rot } })}
          onCommit={(rot) => write({ rot })}
        />
        <PRow label={IC.flip}>
          <ToggleButton size="S" isSelected={!!place.flipX} isDisabled={isDisabled} onChange={(flipX) => write({ flipX })}>
            <FlipHorizontal />
            <Text>{IC.horizontal}</Text>
          </ToggleButton>
          <ToggleButton size="S" isSelected={!!place.flipY} isDisabled={isDisabled} onChange={(flipY) => write({ flipY })}>
            <FlipVertical />
            <Text>{IC.vertical}</Text>
          </ToggleButton>
        </PRow>
      </Sec>
    </>
  );
}

/** 几何段的一格数：标签在上，框里是一位小数的百分比；回车或失焦提交，Esc 放弃，非法输入弹回。 */
function NumField({
  label,
  value,
  isDisabled,
  onCommit,
}: {
  label: string;
  value: number;
  isDisabled: boolean;
  onCommit(value: number): void;
}) {
  const shown = String(value);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [shown]);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const n = Number.parseFloat(draft);
    if (Number.isFinite(n) && n !== value) onCommit(n);
  };
  return (
    <TextField
      label={IC.percentField(label)}
      size="S"
      value={draft ?? shown}
      isDisabled={isDisabled}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}
