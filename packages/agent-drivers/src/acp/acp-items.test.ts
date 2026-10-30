import { describe, expect, it } from 'vitest';
import { toolItem, type ToolSnapshot } from './acp-items.ts';

/** ACP 工具调用 → 时间线上的一步：读、搜、取网页带结构化事实。 */

const snap = (kind: ToolSnapshot['kind'], rawInput: unknown, locations: ToolSnapshot['locations'] = null): ToolSnapshot => ({
  toolCallId: 't1',
  title: 'x',
  kind,
  status: 'completed',
  content: null,
  locations,
  rawInput,
  rawOutput: null,
});

describe('toolItem info', () => {
  it('读取取位置里的路径，搜索取模式，取网页取网址；别的种类与缺键时不写', () => {
    expect(toolItem(snap('read', { path: '/w/b.ts' }, [{ path: '/w/a.ts', line: 3 }])).info).toEqual({ type: 'read', path: '/w/a.ts' });
    expect(toolItem(snap('search', { query: 'cut', path: 'src' })).info).toEqual({ type: 'search', pattern: 'cut', path: 'src' });
    expect(toolItem(snap('fetch', { url: 'https://x.test' })).info).toEqual({ type: 'fetch', url: 'https://x.test' });
    expect(toolItem(snap('search', {}))).not.toHaveProperty('info');
    expect(toolItem(snap('execute', { command: 'ls' }))).not.toHaveProperty('info');
  });
});
