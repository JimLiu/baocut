import { describe, expect, it } from 'vitest';
import { generatedImageGallery, imageFit, imagePoint, imageRegion, imageZoomStep, appendImageRequest } from './image-preview.ts';
import type { SpaceEntry } from '@baocut/protocol';

describe('图片预览模型', () => {
  it('批注坐标不依赖显示倍率，越界钳到图片边缘', () => {
    const a = imagePoint({ x: 150, y: 100 }, { left: 100, top: 50, width: 100, height: 100 })!;
    const b = imagePoint({ x: 200, y: 150 }, { left: 100, top: 50, width: 200, height: 200 })!;
    expect(a).toEqual(b);
    expect(imageRegion(a, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, width: 0.3, height: 0.4 });
    expect(imagePoint({ x: -1, y: 999 }, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ x: 0, y: 1 });
    expect(imagePoint(a, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
  it('适合窗口不放大小图，缩放按档位且有上下限', () => {
    expect(imageFit({ width: 100, height: 100 }, { width: 600, height: 600 })).toBe(1);
    expect(imageFit({ width: 1000, height: 500 }, { width: 548, height: 548 })).toBe(0.5);
    expect(imageZoomStep(83, 1)).toBe(100);
    expect(imageZoomStep(83, -1)).toBe(75);
    expect(imageZoomStep(25, -1)).toBe(10);
    expect(imageZoomStep(300, 1)).toBe(400);
  });
  it('只对同任务候选分组，不合并独立图片、其他会话和已回收文件', () => {
    const entry = (id: string, jobId?: string, conversationId = 'c1', trash: string | null = null): SpaceEntry => ({ id, kind: 'image', name: id, fileName: `${id}.png`, source: { projectId: 'p1', conversationId: null }, relPath: `${id}.png`, size: 1, lastActivityAt: '', status: null, user: { favorite: false, displayName: null, trashedAt: trash }, origin: { source: 'generated', jobId, conversationId } });
    const entries = [entry('a', 'j1'), entry('b', 'j1'), entry('c', 'j2'), entry('d', 'j1', 'c2'), entry('e', 'j1', 'c1', 'now')];
    expect(generatedImageGallery({ target: { entryId: 'a' }, name: 'a' }, entries).map(i => i.name)).toEqual(['a', 'b']);
    expect(generatedImageGallery({ target: { conversationId: 'c1', path: 'single.png' }, name: 'single' }, entries)).toHaveLength(1);
  });
  it('追加请求不删除现有空格或换行', () => {
    expect(appendImageRequest(' draft \n', 'request')).toBe(' draft \n\n\nrequest');
  });
});

it('画布按会话合并生成组并去重，独立图片和上传附件不混入', async()=>{
  const {canvasImageCandidates}=await import('./image-preview.ts');
  const a={target:{conversationId:'c1',path:'a.png'},name:'a',conversationId:'c1',generated:true};
  const b={...a,target:{conversationId:'c1',path:'b.png'},name:'b'};
  const unrelated={...b,conversationId:'c2'};
  expect(canvasImageCandidates([a],{first:[a],second:[b],other:[unrelated]},'c1').map(x=>x.name)).toEqual(['a','b']);
  const single={...a,generated:false};expect(canvasImageCandidates([single],{second:[b]},'c1')).toEqual([single]);
});
