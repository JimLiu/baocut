import { useEffect, useRef } from 'react';
import { ActionButton, NumberField, Picker, PickerItem, SearchField, type TextFieldRef } from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Close from '@react-spectrum/s2/icons/Close';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { PANEL as M } from '../panel-copy.ts';
import { DEVICE_PRESETS, type DeviceSize } from '../../model/web-address.ts';

const row = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingX: 12, paddingY: 8, flexShrink: 0,
  borderBottomWidth: 1, borderBottomStyle: 'solid', borderColor: 'gray-100', font: 'ui-sm' });
const input = style({ width: 144 });

export function WebFindBar({ query, onQuery, active, matches, onStep, onClose, focusTick }: {
  query: string; onQuery: (query: string) => void; active: number; matches: number; onStep: (forward: boolean) => void; onClose: () => void; focusTick: number;
}) {
  const field = useRef<TextFieldRef>(null);
  useEffect(() => { field.current?.getInputElement()?.focus(); field.current?.getInputElement()?.select(); }, [focusTick]);
  return <div className={row}>
    <SearchField ref={field} aria-label={M.find} placeholder={M.find} value={query} maxLength={4096} onChange={onQuery} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); onStep(!event.shiftKey); }
      else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else event.continuePropagation();
    }} />
    <span aria-live="polite">{active} / {matches}</span>
    <ActionButton isQuiet aria-label={M.previousMatch} isDisabled={!matches} onPress={() => onStep(false)}><ChevronLeft /></ActionButton>
    <ActionButton isQuiet aria-label={M.nextMatch} isDisabled={!matches} onPress={() => onStep(true)}><ChevronRight /></ActionButton>
    <ActionButton isQuiet aria-label={M.closeFind} onPress={onClose}><Close /></ActionButton>
  </div>;
}

export function WebDeviceBar({ size, onChange, onClose, onMenu }: { size: DeviceSize; onChange: (size: DeviceSize) => void; onClose: () => void; onMenu: (open: boolean) => void }) {
  const selected = Object.entries(DEVICE_PRESETS).find(([, s]) => s.width === size.width && s.height === size.height)?.[0] ?? 'custom';
  return <div className={row}>
    <Picker aria-label={M.device} selectedKey={selected} onOpenChange={onMenu} onSelectionChange={key => { if (key && key in DEVICE_PRESETS) onChange(DEVICE_PRESETS[key as keyof typeof DEVICE_PRESETS]); }}>
      <PickerItem id="custom">{M.custom}</PickerItem><PickerItem id="phone">{M.phone}</PickerItem><PickerItem id="tablet">{M.tablet}</PickerItem><PickerItem id="laptop">{M.laptop}</PickerItem>
    </Picker>
    <NumberField aria-label={M.width} value={size.width} minValue={240} maxValue={4096} styles={input} onChange={width => { if (Number.isFinite(width)) onChange({ ...size, width }); }} />
    <span>×</span>
    <NumberField aria-label={M.height} value={size.height} minValue={240} maxValue={4096} styles={input} onChange={height => { if (Number.isFinite(height)) onChange({ ...size, height }); }} />
    <ActionButton isQuiet aria-label={M.rotate} onPress={() => onChange({ width: size.height, height: size.width })}><Refresh /></ActionButton>
    <ActionButton isQuiet aria-label={M.closeDevice} onPress={onClose}><Close /></ActionButton>
  </div>;
}
