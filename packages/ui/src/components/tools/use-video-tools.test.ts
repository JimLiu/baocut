import { describe, expect, it } from 'vitest';
import { defaultProject } from './use-video-tools.ts';

describe('新建视频放进哪个项目的缺省', () => {
  const projects = [{ id: 'moved', missing: true as const }, { id: 'a' }, { id: 'b' }];

  it('上次用的还在就用它，否则第一个', () => {
    expect(defaultProject(projects, 'b')).toBe('b');
    expect(defaultProject(projects, 'gone')).toBe('a');
    expect(defaultProject([], null)).toBeNull();
  });

  it('目录不在了的项目不当缺省', () => {
    expect(defaultProject(projects, 'moved')).toBe('a');
    expect(defaultProject([{ id: 'moved', missing: true }], null)).toBeNull();
  });
});
