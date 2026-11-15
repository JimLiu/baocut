// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RecordingSources } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHOICE, type RecordingChoice } from '../../model/recording.ts';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { RC } from './recording-copy.ts';
import { RecordingFields } from './recording-panel.tsx';

const sources = (over: Partial<RecordingSources> = {}): RecordingSources => ({
  platform: 'darwin',
  available: true,
  reason: null,
  permissions: { screen: 'granted', camera: 'granted', microphone: 'granted', inputMonitoring: 'not-determined' },
  displays: [
    { id: '1', name: 'Built-in', width: 1512, height: 982, scale: 2, primary: true },
    { id: '2', name: 'Studio', width: 2560, height: 1440, scale: 1, primary: false },
  ],
  windows: [{ id: 'w1', title: 'Doc', app: 'Notes', width: 800, height: 600 }],
  cameras: [{ id: 'cam1', name: 'FaceTime HD Camera' }],
  microphones: [{ id: 'mic1', name: 'MacBook Pro Microphone', default: true }],
  ...over,
});

const runtime = { host: { platform: 'darwin', recording: { openSystemSettings: async () => {}, configure: () => {} } } } as unknown as RuntimeSession;

const render = (s: RecordingSources, choice: Partial<RecordingChoice> = {}) =>
  renderToStaticMarkup(
    createElement(RuntimeContext.Provider, { value: runtime }, createElement(RecordingFields, { sources: s, choice: { ...DEFAULT_CHOICE, ...choice }, onChange: () => {} })),
  );

describe('RecordingFields', () => {
  it('八项都在：来源、摄像头、麦克风、系统声音、鼠标、键盘、倒计时；多块屏幕时可以选屏幕', () => {
    const html = render(sources());
    for (const text of [RC.source, RC.camera, RC.microphone, RC.systemAudio, RC.cursor, RC.keys, RC.countdown, RC.display]) expect(html).toContain(text);
    expect(html).toContain(RC.permStatus(RC.permScreen, RC.permGranted));
  });

  it('区域没有选框时置灰并说明；没有摄像头时说明', () => {
    const html = render(sources({ cameras: [] }));
    expect(html).toContain(RC.noAreaPicker);
    expect(html).toContain(RC.noCamera);
  });

  it('选了的一路被系统拒绝时给出原因与「打开系统设置」；还没问过的说开始时会问', () => {
    const html = render(sources({ permissions: { screen: 'denied', camera: 'denied', microphone: 'granted', inputMonitoring: 'not-determined' } }), {
      camera: 'cam1',
      keys: 'all',
    });
    expect(html).toContain(RC.permDenied(RC.permScreen));
    expect(html).toContain(RC.permDenied(RC.permCamera));
    expect(html.split(RC.openSettings).length - 1).toBe(2);
    expect(html).toContain(RC.permStatus(RC.permInput, RC.permAsk));
    expect(html).toContain(RC.keysAllNote);
  });

  it('不要光标时说明没有自动缩放；没选摄像头时不显示它的权限', () => {
    const html = render(sources({ permissions: { screen: 'granted', camera: 'denied', microphone: 'granted', inputMonitoring: 'granted' } }), { cursor: 'none' });
    expect(html).toContain(RC.cursorNoneNote);
    expect(html).not.toContain(RC.permDenied(RC.permCamera));
  });

  it('这台电脑录不了时各项置灰', () => {
    const html = render(sources({ available: false, reason: 'nope' }));
    expect(html).toMatch(/disabled/);
  });
});
