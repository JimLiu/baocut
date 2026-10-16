import { describe, expect, it } from 'vitest';
import type { TemplateLayers } from '@baocut/protocol';
import {
  addLayer,
  dragBox,
  hitLayer,
  moveLayer,
  openStudio,
  quickBox,
  removeLayer,
  resizeBox,
  setDraft,
  setLayerBox,
  studioDirty,
} from './template-studio.ts';

const frame = { width: 800, height: 450 };

function doc(): TemplateLayers {
  return {
    id: 'tpl_talk',
    name: 'Talk',
    canvas: '16:9',
    layers: [
      { id: 'bar', kind: 'progress', accent: '#FF8800', track: '#FFFFFF40', box: { x: 0, y: 98, w: 100, h: 2 } },
      { id: 'logo', kind: 'logo', src: 'text', text: 'ACME', color: '#FFFFFF', box: { x: 2, y: 4, w: 14, h: 8 } },
    ],
  };
}

describe('版面编辑器的草稿', () => {
  it('从空白开始没有层；改的是深拷贝，打开时的样子留着比对', () => {
    const blank = openStudio('new-brand', null, null, 'Untitled');
    expect(blank.draft.layers).toEqual([]);
    expect(blank.draft.name).toBe('Untitled');
    expect(blank.layer).toBeNull();

    const source = doc();
    const studio = openStudio('video', source, null, 'Untitled');
    expect(studio.layer).toBe('bar');
    const moved = setLayerBox(studio, 'logo', { x: 50, y: 50, w: 14, h: 8 });
    expect(source.layers[1]!.box.x).toBe(2);
    expect(studioDirty(studio)).toBe(false);
    expect(studioDirty(moved)).toBe(true);
  });

  it('加一层放在最上面、ID 不重并选中；删掉选中的那层不再选中', () => {
    let studio = openStudio('video', doc(), null, 'Untitled');
    studio = addLayer(studio, 'text', 'en');
    const added = studio.draft.layers.at(-1)!;
    expect(added.kind).toBe('text');
    expect(['bar', 'logo']).not.toContain(added.id);
    expect(studio.layer).toBe(added.id);
    studio = removeLayer(studio, added.id);
    expect(studio.draft.layers.map((l) => l.id)).toEqual(['bar', 'logo']);
    expect(studio.layer).toBeNull();
  });

  it('上下挪一层，到头不动', () => {
    const studio = openStudio('video', doc(), null, 'Untitled');
    expect(moveLayer(studio, 'bar', 1).draft.layers.map((l) => l.id)).toEqual(['logo', 'bar']);
    expect(moveLayer(studio, 'logo', 1)).toBe(studio);
    expect(moveLayer(studio, 'bar', -1)).toBe(studio);
  });

  it('清掉套用时画幅时锁一并去掉', () => {
    const studio = setDraft(openStudio('video', doc(), null, 'Untitled'), { ratio: '9:16', lockRatio: true });
    expect(studio.draft.lockRatio).toBe(true);
    const cleared = setDraft(studio, { ratio: undefined });
    expect(cleared.draft.ratio).toBeUndefined();
    expect(cleared.draft.lockRatio).toBeUndefined();
  });

  it('框的几何经引擎：拖动按像素折百分比、拉伸对边不动、都夹在画面里', () => {
    const box = { x: 10, y: 10, w: 20, h: 10 };
    expect(dragBox(box, 80, 45, frame)).toEqual({ x: 20, y: 20, w: 20, h: 10 });
    expect(dragBox(box, -800, 0, frame).x).toBe(0);
    const wider = resizeBox(box, 'w', -40, 0, frame);
    expect(wider.x + wider.w).toBeCloseTo(30);
    expect(wider.x).toBe(5);
    expect(quickBox(box, 'full')).toMatchObject({ x: 0, w: 100 });
    expect(quickBox(box, 'bottom')).toMatchObject({ y: 90 });
    expect(quickBox(box, 'center')).toMatchObject({ x: 40 });
  });

  it('命中自顶向下，跳过关掉的层', () => {
    const d = doc();
    expect(hitLayer(d, 5, 6)).toBe('logo');
    expect(hitLayer(d, 50, 99)).toBe('bar');
    expect(hitLayer({ ...d, layers: [d.layers[0]!, { ...d.layers[1]!, on: false }] }, 5, 6)).toBeNull();
  });
});
