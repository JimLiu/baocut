import { useState } from 'react';
import type { Easing, SequenceItem } from '@baocut/protocol';
import { Picker, PickerItem, Switch, ToggleButton } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  DEFAULT_SECONDS,
  DIRECTIONS,
  EASINGS,
  SLOTS,
  TRANSITION_CHOICES,
  directed as directedKind,
  durationLimits,
  hasSound,
  slotNeighbor,
  slotOperations,
  singleSided,
  slotState,
  type SlotState,
  type TransitionSlot,
} from '../../model/transition-panel.ts';
import { ColorField, Note, PRow, Sec, SecHead, Seg, ValueRow } from './inspector-controls.tsx';
import type { ItemPageProps } from './inspector-sections.tsx';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

const tiles = style({ display: 'grid', gridTemplateColumns: ['1fr', '1fr', '1fr', '1fr'], gap: 4 });
const tile = style({ width: 'full' });
const grow = style({ flexGrow: 1, minWidth: 0 });

/**
 * 转场（视频格式规范 §3.9）：「进入」是片段开头那条边，「离开」是结尾那条边。选即应用（`setTransition`，可撤销），
 * 选「无」删掉。同一轨道上首尾相接的邻居在时可以和它衔接（两侧转场），否则另一侧是透明的、露出下面的轨道。
 */
export function TransitionSection({ item, sequence, edit, canChange }: ItemPageProps<Exclude<SequenceItem, { type: 'audio' | 'caption' }>>) {
  const [slot, setSlot] = useState<TransitionSlot>('in');
  const state = slotState(sequence, item, slot);
  const neighbor = slotNeighbor(sequence, item, slot);
  const limits = durationLimits(item, sequence.fps);
  const write = (patch: Partial<SlotState>) => {
    const operations = slotOperations(sequence, item, slot, { ...state, ...patch });
    if (operations.length) edit.commit(operations);
  };
  const joined = state.joined && !!neighbor;
  const hint = joined
    ? slot === 'in'
      ? IC.trHintJoinedIn
      : IC.trHintJoinedOut
    : slot === 'in'
      ? IC.trHintIn
      : IC.trHintOut;
  const directed = directedKind(state.kind);
  return (
    <>
      <SecHead>{IC.transition}</SecHead>
      <Sec>
        <Seg<TransitionSlot> label={IC.trSlot} value={slot} options={SLOTS} onChange={setSlot} />
        <div className={tiles} role="group" aria-label={IC.trEffects}>
          {TRANSITION_CHOICES.map((choice) => (
            <ToggleButton
              key={choice.key}
              size="S"
              styles={tile}
              isSelected={state.kind === choice.key && !state.unknownKind}
              isDisabled={!canChange || (!joined && !singleSided(choice.key))}
              onChange={() => {
                if (choice.key === state.kind && !state.unknownKind) return;
                const fresh = state.kind === 'none';
                write({ kind: choice.key, ...(fresh ? { seconds: Math.max(limits.min, Math.min(DEFAULT_SECONDS, limits.max)) } : {}) });
              }}>
              {choice.label}
            </ToggleButton>
          ))}
        </div>
        {state.unknownKind ? <Note>{IC.trUnknown(state.unknownKind)}</Note> : null}
        {state.kind !== 'none' ? (
          <>
            <ValueRow
              label={IC.duration}
              value={Math.round(state.seconds * 100) / 100}
              min={limits.min}
              max={limits.max}
              hardMax={limits.hardMax}
              step={0.1}
              digits={2}
              unit={IC.seconds}
              isDisabled={!canChange || limits.max <= 0}
              onCommit={(seconds) => write({ seconds })}
            />
            {directed ? (
              <PRow label={IC.direction}>
                <Seg label={IC.direction} value={state.direction} options={DIRECTIONS} isDisabled={!canChange} onChange={(direction) => write({ direction })} />
              </PRow>
            ) : null}
            {state.kind === 'dip-to-color' ? (
              <PRow label={IC.color}>
                <ColorField
                  label={IC.overlayColor}
                  value={state.color}
                  fallback="#000000"
                  allowAlpha={false}
                  isDisabled={!canChange}
                  onCommit={(color) => write({ color })}
                />
              </PRow>
            ) : null}
            <PRow label={IC.easing}>
              <Picker
                aria-label={IC.easing}
                size="S"
                styles={grow}
                selectedKey={state.easing}
                isDisabled={!canChange}
                onSelectionChange={(key) => key !== null && key !== state.easing && write({ easing: key as Easing })}>
                {EASINGS.map((easing) => (
                  <PickerItem key={easing.key} id={easing.key}>
                    {easing.label}
                  </PickerItem>
                ))}
              </Picker>
            </PRow>
            {neighbor ? (
              <PRow label={IC.trJoin}>
                <Switch
                  size="S"
                  isSelected={joined}
                  isDisabled={!canChange || (joined && !singleSided(state.kind))}
                  onChange={(on) => write({ joined: on })}>
                  {slot === 'in' ? IC.trPrevious : IC.trNext}
                </Switch>
              </PRow>
            ) : null}
            {joined && hasSound(item) && hasSound(neighbor) ? (
              <PRow label={IC.sound}>
                <Switch size="S" isSelected={state.audioCrossfade} isDisabled={!canChange} onChange={(on) => write({ audioCrossfade: on })}>
                  {IC.trCrossfade}
                </Switch>
              </PRow>
            ) : null}
          </>
        ) : null}
        <Note>{IC.trApplyNote(hint)}</Note>
      </Sec>
    </>
  );
}
