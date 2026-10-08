import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_ATTACHMENTS_PER_MESSAGE, type MediaHandle } from '@baocut/protocol';
import { addImageRequest } from './image-request.ts';
import { useDraftImages } from './draft-images-store.ts';
import { useShell } from './shell-store.ts';
const handle: MediaHandle = { url: 'http://localhost/media/test', mimeType: 'image/png', size: 3, fileName: 'a.png', expiresAt: '' };
const target = { conversationId: 'c1', path: 'a.png' };
beforeEach(() => { useDraftImages.setState({ images: {} }); useShell.setState({ drafts: { c1: 'existing' } }); });
afterEach(() => { useDraftImages.getState().clear('c1'); vi.unstubAllGlobals(); });
it('读取期间的新文字保留，重复图片只附加一次，请求不自动发送', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const promise = addImageRequest('c1', target, handle, 'a.png', {} as HTMLImageElement, 'change');
  useShell.getState().setDraft('c1', 'typed while reading');
  finish(new Response(Uint8Array.of(1, 2, 3))); await promise;
  expect(useShell.getState().drafts.c1).toBe('typed while reading\n\nchange');
  await addImageRequest('c1', target, handle, 'a.png', {} as HTMLImageElement, 'ratio');
  expect(useDraftImages.getState().images.c1).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('读取失败不污染草稿与附件，已满时也不读文件', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 })); vi.stubGlobal('fetch', fetch);
  await expect(addImageRequest('c1', target, handle, 'a.png', {} as HTMLImageElement, 'change')).rejects.toThrow('404');
  expect(useShell.getState().drafts.c1).toBe('existing');
  expect(useDraftImages.getState().images.c1).toBeUndefined();
  useDraftImages.getState().add('c1', Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, i) => ({ id: String(i), file: new File([], 'test.png'), url: 'blob:test' })));
  await expect(addImageRequest('c1', target, handle, 'a.png', {} as HTMLImageElement, 'change')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('批量准备失败不修改草稿，第二次检查保护读取期间新增的附件',async()=>{
  const {addImageBatch}=await import('./image-request.ts');
  const fetch=vi.fn().mockResolvedValue(new Response('',{status:404}));vi.stubGlobal('fetch',fetch);
  await expect(addImageBatch('c1',[{target,handle,name:'a.png',image:{} as HTMLImageElement}], 'batch')).rejects.toThrow();
  expect(useShell.getState().drafts.c1).toBe('existing');expect(useDraftImages.getState().images.c1).toBeUndefined();
});

it('Composer 中已有图片的编辑请求不重复附上图片',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  useDraftImages.getState().add('c1',[{id:'img_existing',file:new File(['x'],'a.png',{type:'image/png'}),url:'blob:existing'}]);
  await addImageRequest('c1',{conversationId:'c1',attachmentId:'img_existing'},handle,'a.png',{} as HTMLImageElement,'adjust');
  expect(fetch).not.toHaveBeenCalled();expect(useDraftImages.getState().images.c1).toHaveLength(1);
  expect(useShell.getState().drafts.c1).toBe('existing\n\nadjust');
});
