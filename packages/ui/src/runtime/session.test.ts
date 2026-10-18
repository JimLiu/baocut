import { expect, it, vi } from 'vitest';
import type { LegacyImportEvent, LegacyImportSnapshot } from '@baocut/protocol';
import type { HostBridge } from '../host.ts';
import { useDirectory } from '../state/directory-store.ts';
import { useShell } from '../state/shell-store.ts';
import { RuntimeSession } from './session.ts';

it('keeps settings recovery through project events and replaces it on a reconnect snapshot', () => {
  let listener!: { snapshot(value: LegacyImportSnapshot): void; event(value: LegacyImportEvent): void };
  const unsubscribe = vi.fn();
  const client = { subscribeLegacyImport: vi.fn((callbacks: typeof listener) => { listener = callbacks; return unsubscribe; }) };
  const onChange = vi.fn();
  const stop = RuntimeSession.prototype.watchLegacyImport.call({ client } as unknown as RuntimeSession, onChange);
  const settingsReport = { reportId: 'report', fields: ['transcribe.sourceLang' as const], modelsDirectory: null };
  listener.snapshot({ prompt: null, run: null, settingsReport });
  listener.event({ type: 'prompt.updated', prompt: null });
  listener.event({ type: 'run.updated', run: null });
  expect(onChange.mock.calls.map(([snapshot]) => snapshot)).toEqual([
    { prompt: null, run: null, settingsReport },
    { prompt: null, run: null, settingsReport },
    { prompt: null, run: null, settingsReport },
  ]);
  listener.snapshot({ prompt: null, run: null });
  expect(onChange).toHaveBeenLastCalledWith({ prompt: null, run: null });
  stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('sends skipProjectBrand only when the brand token was dismissed', async () => {
  const request = vi.fn(async () => ({ taskId: 't' }));
  const send = RuntimeSession.prototype.send.bind({ client: { request } } as unknown as RuntimeSession);
  await send('c', 'hi');
  await send('c', 'hi', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { skipProjectBrand: true });
  const params = request.mock.calls.map((call) => (call as unknown as [string, Record<string, unknown>])[1]);
  expect(params[0]).not.toHaveProperty('skipProjectBrand');
  expect(params[1]).toMatchObject({ conversationId: 'c', skipProjectBrand: true });
});

it('opens each video an external agent created once, even when a reconnect replays the event', () => {
  const openExternalVideo = vi.fn();
  useShell.setState({ openExternalVideo });
  const session = new RuntimeSession({ platform: 'test', getConnection: async () => null } as unknown as HostBridge);
  const created = { videoId: 'v1', videoName: 'Demo', target: { projectId: 'p1', path: 'Demo' }, by: 'cli' } as const;
  session.openExternalVideo(created);
  session.openExternalVideo(created);
  session.openExternalVideo({ ...created, videoId: 'v2', target: { projectId: 'p1', path: 'Other' } });
  expect(openExternalVideo.mock.calls).toEqual([
    [{ projectId: 'p1', path: 'Demo' }, false],
    [{ projectId: 'p1', path: 'Other' }, false],
  ]);
});

it('tells the shell the conversation on screen is busy while its task runs', () => {
  const openExternalVideo = vi.fn();
  useShell.setState({ route: { tab: 'home', conversationId: 'c1', projectId: null }, openExternalVideo });
  useDirectory.setState({ conversations: [{ id: 'c1', activeTaskId: 't1' } as never] });
  const session = new RuntimeSession({ platform: 'test', getConnection: async () => null } as unknown as HostBridge);
  session.openExternalVideo({ videoId: 'v3', videoName: 'Busy', target: { projectId: 'p1', path: 'Busy' }, by: 'mcp' });
  useDirectory.setState({ conversations: [{ id: 'c1', activeTaskId: null } as never] });
  session.openExternalVideo({ videoId: 'v4', videoName: 'Idle', target: { projectId: 'p1', path: 'Idle' }, by: 'mcp' });
  expect(openExternalVideo.mock.calls.map(([, busy]) => busy)).toEqual([true, false]);
});
