// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from '@react-spectrum/s2';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LibraryEntrySummary } from '@baocut/protocol';
import { speechModel } from '../model/models-test-fixtures.ts';
import type { SpeechOption } from '../model/tools-tts.ts';
import { VoiceFixLine } from './voice-clone-fix.tsx';
import { VoicePicker } from './voice-picker.tsx';

const voice = (id: string, name: string, patch: Partial<LibraryEntrySummary> = {}): LibraryEntrySummary => ({
  library: 'voices',
  id,
  version: 1,
  name,
  contentHash: 'sha256:v',
  kind: 'voice',
  updatedAt: '2026-10-01T00:00:00.000Z',
  consentDeclared: true,
  clones: [],
  ...patch,
});

const info = { ...speechModel('eleven_v3', []), voices: [{ voiceId: 'JBFqnCBsd6', label: 'George' }], defaultVoice: 'JBFqnCBsd6' };
const eleven: SpeechOption = {
  key: 'elevenlabs/eleven_v3',
  providerId: 'elevenlabs',
  provider: 'ElevenLabs',
  modelId: 'eleven_v3',
  label: 'eleven_v3',
  connected: true,
  usable: true,
  why: null,
  info,
};
const cloned = voice('a', '我的播客声', { clones: [{ providerId: 'elevenlabs', state: 'valid' }] });
const fresh = voice('b', '新录的');

const onChange = vi.fn();
const onFix = vi.fn();
let container: HTMLDivElement;
let root: Root;

async function press(el: Element) {
  await act(async () => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
    (el as HTMLElement).click();
  });
}

async function render(node: ReturnType<typeof createElement>) {
  await act(() => root.render(createElement(Provider, { locale: 'zh-CN', children: node })));
}

/** happy-dom 没有布局，弹出的列表只画得出一项；走 React Aria 同时画的隐藏原生 select（同一个 onSelectionChange）。 */
async function pick(key: string) {
  await render(createElement(VoicePicker, { label: '音色', draft: { voice: 'default' }, option: eleven, voices: [cloned, fresh], onChange, onFix }));
  const select = container.querySelector('select')!;
  expect([...select.options].map((o) => o.value)).toContain(key);
  await act(async () => {
    select.value = key;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  onChange.mockClear();
  onFix.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('还没在这家建好的我的声音能选：选上并去补那一步', async () => {
  await pick('library:b');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('library:b');
  expect(onFix).toHaveBeenCalledExactlyOnceWith(fresh, 'upload');
});

it('已建好的只选上，不补', async () => {
  await pick('library:a');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('library:a');
  expect(onFix).not.toHaveBeenCalled();
});

it('控件下那一句：补得上时带按钮，在传时转圈没有按钮，没得补时只有一句', async () => {
  await render(createElement(VoiceFixLine, { line: '还没建', fix: 'upload', provider: 'ElevenLabs', className: 'x', onFix }));
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('ElevenLabs'))!;
  await press(button);
  expect(onFix).toHaveBeenCalledOnce();

  await render(createElement(VoiceFixLine, { line: '正在上传', fix: 'wait', provider: 'ElevenLabs', className: 'x', onFix }));
  expect(container.querySelector('[role="status"]')?.textContent).toContain('正在上传');
  expect(container.querySelector('button')).toBeNull();

  await render(createElement(VoiceFixLine, { line: '用这家的克隆合成', fix: null, provider: 'ElevenLabs', className: 'x', onFix }));
  expect(container.querySelector('p')?.textContent).toBe('用这家的克隆合成');
});
