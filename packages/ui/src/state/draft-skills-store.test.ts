import { beforeEach, describe, expect, it } from 'vitest';
import { useDraftSkills } from './draft-skills-store.ts';

describe('输入框点选的 skill 草稿', () => {
  beforeEach(() => useDraftSkills.setState({ skills: {} }));

  it('按挂上的顺序追加，重复的不再加；不同草稿键互不影响', () => {
    const store = useDraftSkills.getState();
    store.add('c1', 'caption-layout');
    store.add('c1', 'b-roll');
    store.add('c1', 'caption-layout');
    store.add('c2', 'blog-post');
    expect(useDraftSkills.getState().skills).toEqual({ c1: ['caption-layout', 'b-roll'], c2: ['blog-post'] });
  });

  it('逐个摘掉；摘光了键也去掉', () => {
    const store = useDraftSkills.getState();
    store.set('c1', ['a', 'b', 'a', 'c']);
    expect(useDraftSkills.getState().skills.c1).toEqual(['a', 'b', 'c']);
    store.remove('c1', 'b');
    expect(useDraftSkills.getState().skills.c1).toEqual(['a', 'c']);
    store.remove('c1', 'a');
    store.remove('c1', 'c');
    expect(useDraftSkills.getState().skills).toEqual({});
  });

  it('没变化时不换引用；整组搬到另一个草稿键', () => {
    const store = useDraftSkills.getState();
    store.add('draft', 'a');
    const before = useDraftSkills.getState().skills;
    store.add('draft', 'a');
    store.remove('draft', 'nope');
    expect(useDraftSkills.getState().skills).toBe(before);
    store.add('draft', 'b');
    store.move('draft', 'c1');
    expect(useDraftSkills.getState().skills).toEqual({ c1: ['a', 'b'] });
  });
});
