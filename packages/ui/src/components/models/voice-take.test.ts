// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from '@react-spectrum/s2';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { analyzeTake, type RecordingSpec, type SaveTakeWarning } from '../../model/voice-capture.ts';
import { CAPTURE_COPY as CC } from './voices-copy.ts';
import { ClipRecorder, TakeWarning, type Clip } from './voice-take.tsx';

const spec: RecordingSpec = { min: 10, target: 30, max: 180, countdown: 10 };
const rate = 48_000;

/** 一段 2 秒的「录音」：开头 0.5 秒安静的房间（底噪在这里量），后面是正弦「人声」，`amp` 超过 1 的削顶。 */
function tone(amp: number): Float32Array {
  const out = new Float32Array(rate * 2);
  for (let i = 0; i < out.length; i++) {
    const a = i < rate / 2 ? 0.001 : amp;
    out[i] = Math.max(-1, Math.min(1, a * Math.sin((2 * Math.PI * 220 * i) / rate)));
  }
  return out;
}

function clip(amp: number, mic: Clip['mic']): Clip {
  return { bytes: new Uint8Array(), seconds: 2, via: mic ? 'mic' : 'upload', name: mic ? null : 'take.wav', trimmed: false, analysis: analyzeTake(tone(amp), rate), mic };
}

const builtIn = { id: 'built-in', group: 'g-built-in', label: 'Built-in Microphone' };
const usb = { id: 'usb', group: 'g-usb', label: 'USB Microphone' };
let container: HTMLDivElement;
let root: Root;

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => root.render(createElement(Provider, { locale: 'en-US', children: element })));
}

const text = () => container.textContent ?? '';
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      enumerateDevices: async () => [
        { kind: 'audioinput', deviceId: 'default', groupId: builtIn.group, label: 'Default' },
        { kind: 'audioinput', deviceId: builtIn.id, groupId: builtIn.group, label: builtIn.label },
        { kind: 'audioinput', deviceId: usb.id, groupId: usb.group, label: usb.label },
      ],
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('says nothing before saving a clean take', async () => {
  await render(createElement(TakeWarning, { warnings: [], uploadTo: 'Google Gemini' }));
  expect(text()).toBe('');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('lists each clip’s problems before saving and goes back to re-record', async () => {
  const warnings: SaveTakeWarning[] = [
    { step: 'sample', kind: 'clipping' },
    { step: 'sample', kind: 'noisy' },
    { step: 'consent', kind: 'mic' },
  ];
  const onRedo = vi.fn();
  await render(createElement(TakeWarning, { warnings, uploadTo: 'Google Gemini', onRedo }));
  expect(text()).toContain(CC.warnTitle('Google Gemini'));
  const items = [...container.querySelectorAll('li')].map((li) => li.textContent);
  expect(items).toEqual([CC.warnSample([CC.takeIssue.clipping, CC.takeIssue.noisy]), CC.warnMic]);
  expect(text()).toContain(CC.warnBody);
  await act(async () => button(CC.redoConsent)!.click());
  expect(onRedo).toHaveBeenCalledWith('consent');
  expect(button(CC.redoSample)).toBeTruthy();
});

it('warns about a local-only save without naming a provider or offering redo', async () => {
  await render(createElement(TakeWarning, { warnings: [{ step: 'sample', kind: 'noisy' }], uploadTo: '' }));
  expect(text()).toContain(CC.warnTitleLocal);
  expect(text()).toContain(CC.warnBodyLocal);
  expect(container.querySelector('button')).toBeNull();
});

it('gives a verdict with a concrete fix after a take', async () => {
  await render(createElement(ClipRecorder, { spec, clip: clip(1.4, builtIn), onClip: () => {}, hint: '' }));
  expect(text()).toContain(CC.takeTitle([CC.takeIssue.clipping]));
  expect(text()).toContain(CC.takeFix.clipping);

  await render(createElement(ClipRecorder, { spec, clip: clip(0.3, builtIn), onClip: () => {}, hint: '' }));
  expect(text()).toContain(CC.takeOk);
  expect(text()).toContain(CC.takeOkFix);
});

it('flags a consent take on another microphone and offers to switch back', async () => {
  const sample = clip(0.3, builtIn);
  const onDeviceId = vi.fn();
  await render(createElement(ClipRecorder, { spec, clip: null, onClip: () => {}, hint: '', deviceId: usb.id, onDeviceId, sample, needed: ['Google Gemini'] }));
  expect(text()).toContain(CC.micNow(builtIn.label, usb.label, 'Google Gemini'));
  await act(async () => button(CC.switchMic(builtIn.label))!.click());
  expect(onDeviceId).toHaveBeenCalledWith(builtIn.id);

  // 系统默认就是录样本那只（同一个 groupId）：不提醒。
  await render(createElement(ClipRecorder, { spec, clip: null, onClip: () => {}, hint: '', deviceId: 'default', onDeviceId, sample, needed: ['Google Gemini'] }));
  expect(text()).not.toContain(CC.micNow(builtIn.label, CC.defaultDevice, 'Google Gemini'));

  // 已经用另一只录好：说清楚，换回来重录。
  await render(createElement(ClipRecorder, { spec, clip: clip(0.3, usb), onClip: () => {}, hint: '', deviceId: usb.id, onDeviceId, sample, needed: ['Google Gemini'] }));
  expect(text()).toContain(CC.micTaken(builtIn.label, usb.label, 'Google Gemini'));
});
