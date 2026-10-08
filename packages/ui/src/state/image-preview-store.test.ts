import { beforeEach, expect, it } from 'vitest';
import { useImagePreview } from './image-preview-store.ts';
beforeEach(() => useImagePreview.setState({ notes: {}, groups: {}, activeGroups: {} }));
it('切换图片保留各自的批注草稿，编辑不重复创建，删除清掉对应编辑草稿', () => {
  const store = useImagePreview.getState();
  const region = { x: .2, y: .3, width: .4, height: .1 };
  store.patch('a', { region, text: 'A' }); store.patch('b', { region, text: 'B' });
  store.save('a');
  expect(useImagePreview.getState().notes.b?.draft.text).toBe('B');
  const id = useImagePreview.getState().notes.a!.comments[0]!.id;
  store.patch('a', { region, text: 'edited', editing: id }); store.save('a');
  expect(useImagePreview.getState().notes.a!.comments).toEqual([{ id, region, text: 'edited' }]);
  store.patch('a', { region, text: 'unsaved', editing: id }); store.remove('a', id);
  expect(useImagePreview.getState().notes.a!.draft.editing).toBeNull();
  expect(useImagePreview.getState().notes.a!.comments).toEqual([]);
});
it('同一回复中的图片去重，另一个回复不会混进同组', () => {
  const image = { target: { conversationId: 'c1', path: 'a.png' }, name: 'a' };
  const store = useImagePreview.getState(); store.register('reply1', image); store.register('reply1', image);
  store.register('reply2', { ...image, name: 'b', target: { conversationId: 'c1', path: 'b.png' } });
  expect(useImagePreview.getState().groups.reply1).toEqual([image]);
});
it('句柄返回顺序不同仍按正文顺序展示候选', () => {
  const store = useImagePreview.getState();
  store.register('reply', { target: { entryId: 'b' }, name: 'b', order: [2, 0] });
  store.register('reply', { target: { entryId: 'a' }, name: 'a', order: [1, 0] });
  expect(useImagePreview.getState().groups.reply!.map(c => c.name)).toEqual(['a', 'b']);
});

it('相同图片出现在两次回复时，按本次点击的回复选择候选组', () => {
  const store = useImagePreview.getState();
  const image = { target: { entryId: 'shared' }, name: 'shared' };
  store.register('first', image); store.register('second', image);
  store.activate('second');
  expect(useImagePreview.getState().activeGroups['entry:shared']).toBe('second');
});
