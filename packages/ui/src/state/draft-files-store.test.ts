import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@baocut/protocol';
import { COMPOSER_MENU } from '../copy.ts';
import { useDraftFiles } from './draft-files-store.ts';

describe('会话文件引用草稿', () => {
  beforeEach(() => useDraftFiles.setState({ files: {} }));
  const file = (path: string) => ({ path, kind: 'file' as const });

  it('不同会话隔离，同一路径去重，保留目录类型', () => {
    const store = useDraftFiles.getState();
    expect(store.add('a', [file('/one'), file('/one'), { path: '/folder', kind: 'directory' }])).toBe(0);
    store.add('b', [file('/two')]);
    expect(useDraftFiles.getState().files.a).toEqual([file('/one'), { path: '/folder', kind: 'directory' }]);
    store.remove('a', '/one');
    expect(useDraftFiles.getState().files.a).toEqual([{ path: '/folder', kind: 'directory' }]);
    expect(useDraftFiles.getState().files.b).toEqual([file('/two')]);
  });

  it('最多 8 个路径，重复项不挤占名额；发送中加入的引用保留', () => {
    const store = useDraftFiles.getState();
    const first = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, i) => file(`/f${i}`));
    expect(store.add('a', [...first, first[0]!, file('/extra')])).toBe(1);
    store.sent('a', first.map(entry => entry.path));
    expect(useDraftFiles.getState().files.a).toBeUndefined();
    store.add('a', [file('/sent')]);
    store.add('a', [file('/added-later')]);
    store.sent('a', ['/sent']);
    expect(useDraftFiles.getState().files.a).toEqual([file('/added-later')]);
  });

  it('传给 Agent 的路径逐行加引号，保留空格与反斜杠，文件名换行不会变成额外的指令行', () => {
    expect(COMPOSER_MENU.filesMessage(['/a folder/a.txt', 'C:\\my files\\test.txt', '/name\nnew line'])).toBe(
      '文件和文件夹:\n"/a folder/a.txt"\n"C:\\\\my files\\\\test.txt"\n"/name\\nnew line"',
    );
  });
});
