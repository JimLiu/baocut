import { describe, expect, it } from 'vitest';
import type { EditorToHostMessage, HostToEditorMessage } from '@baocut/slides/editor-messages';
import type { ParentLink } from '@baocut/slides/editor';
import { createBrowserDownloads, createDownloadsBridge } from './downloads-bridge.ts';

function fakeLink() {
  const sent: EditorToHostMessage[] = [];
  const listeners = new Set<(message: HostToEditorMessage) => void>();
  const link: ParentLink = {
    post: message => sent.push(message),
    onMessage: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const deliver = (message: HostToEditorMessage) => listeners.forEach(l => l(message));
  return { link, sent, deliver, listeners };
}

describe('createDownloadsBridge', () => {
  it('save 把文件发给父窗口，父窗口存好后兑现', async () => {
    const parent = fakeLink();
    const downloads = createDownloadsBridge(parent.link, () => 's1');
    const data = new Uint8Array([60, 104, 49, 62]).buffer;
    const done = downloads.capability.save({ filename: 'Landing.html', data, request: 'r'.repeat(20) });
    expect(parent.sent).toEqual([{ type: 'editor:save-file', requestId: 's1', filename: 'Landing.html', data }]);
    // 别的请求的回应不算
    parent.deliver({ type: 'editor:save-file-result', requestId: 'other', outcome: 'failed' });
    parent.deliver({ type: 'editor:save-file-result', requestId: 's1', outcome: 'saved' });
    await expect(done).resolves.toBeUndefined();
  });

  it('取消与没存成都拒绝，错误带运行时认的 code', async () => {
    const parent = fakeLink();
    let n = 0;
    const downloads = createDownloadsBridge(parent.link, () => `s${++n}`);
    const cancelled = downloads.capability.save({ filename: 'a.pdf', data: new ArrayBuffer(1) });
    const failed = downloads.capability.save({ filename: 'b.png', data: new ArrayBuffer(1) });
    parent.deliver({ type: 'editor:save-file-result', requestId: 's1', outcome: 'declined' });
    parent.deliver({ type: 'editor:save-file-result', requestId: 's2', outcome: 'failed' });
    await expect(cancelled).rejects.toMatchObject({ code: 'declined' });
    await expect(failed).rejects.toMatchObject({ code: 'failed' });
  });

  it('dispose 停止收消息，等着的按没存成拒绝', async () => {
    const parent = fakeLink();
    const downloads = createDownloadsBridge(parent.link, () => 's1');
    const waiting = downloads.capability.save({ filename: 'a.zip', data: new ArrayBuffer(1) });
    downloads.dispose();
    expect(parent.listeners.size).toBe(0);
    await expect(waiting).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('createBrowserDownloads', () => {
  it('save 用临时的 <a download> 交给浏览器下载，随即兑现，稍后撤销地址', async () => {
    const clicks: { href: string; download: string; blob: Blob | undefined }[] = [];
    const blobs = new Map<string, Blob>();
    const revoked: string[] = [];
    const timers: (() => void)[] = [];
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: () => clicks.push({ href: anchor.href, download: anchor.download, blob: blobs.get(anchor.href) }),
      remove: () => {},
    };
    const win = {
      Blob,
      URL: {
        createObjectURL: (blob: Blob) => {
          const url = `blob:test/${blobs.size + 1}`;
          blobs.set(url, blob);
          return url;
        },
        revokeObjectURL: (url: string) => revoked.push(url),
      },
      document: { createElement: () => anchor, body: { append: () => {} } },
      setTimeout: (run: () => void) => timers.push(run),
    } as unknown as Window & typeof globalThis;
    const downloads = createBrowserDownloads(win);
    await expect(downloads.save({ filename: 'Site.pdf', data: new Uint8Array([37, 80, 68, 70]).buffer })).resolves.toBeUndefined();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ href: 'blob:test/1', download: 'Site.pdf' });
    expect(await clicks[0]?.blob?.text()).toBe('%PDF');
    expect(revoked).toEqual([]);
    timers.forEach(run => run());
    expect(revoked).toEqual(['blob:test/1']);
  });
});
