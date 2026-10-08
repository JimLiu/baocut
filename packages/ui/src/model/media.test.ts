import {expect,it} from 'vitest';
import type {SpaceEntry} from '@baocut/protocol';
import {previewMemoryKey} from './media.ts';
it('正文、文件标签和 Space 的同一个媒体共用播放状态',()=>{
  const entries=[{id:'e1',source:{projectId:'p1'},relPath:'clip.mp4'} as SpaceEntry];
  const conversations=[{id:'c1',projectId:'p1'}];
  const keys=[{entryId:'e1'},{projectId:'p1',path:'clip.mp4'},{conversationId:'c1',path:'clip.mp4'}].map(target=>previewMemoryKey(target,entries,conversations));
  expect(new Set(keys).size).toBe(1);
  expect(previewMemoryKey({conversationId:'c1',attachmentId:'a1'},entries,conversations)).not.toBe(keys[0]);
});
it('绝对路径不误当项目内相对路径，Windows 与 Unix 一致',()=>{
  expect(previewMemoryKey({conversationId:'c1',path:'C:\\Video\\clip.mp4'},[],[{id:'c1',projectId:'p1'}])).toBe('conv:c1:C:\\Video\\clip.mp4');
  expect(previewMemoryKey({conversationId:'c1',path:'/tmp/clip.mp4'},[],[{id:'c1',projectId:'p1'}])).toBe('conv:c1:/tmp/clip.mp4');
});
