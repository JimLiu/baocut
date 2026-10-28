import { describe, expect, it } from 'vitest';
import {
  blankForm,
  editRequest,
  expandPlan,
  imageEditProblems,
  imageEditToolOfPipeline,
  selectionStats,
  sendsWhole,
  upscaleRequest,
  upscaleSize,
  workArea,
  type ImageSource,
} from './tools-image-edit.ts';

/** 图片处理五个工具的纯模型（设计稿 model-image-edit.js）：选区、扩图几何、表单检查与提交参数。 */

const src = (input: string, width = 2000, height = 1000): ImageSource => ({ input, name: input, width, height, url: null });

describe('图片处理', () => {
  it('放大：照片模型的 2、3 倍先放大 4 倍，上限按中间那一步查', () => {
    expect(upscaleSize({ width: 3000, height: 2000 }, 4, 'photo')).toEqual({ width: 12000, height: 8000, tooLarge: false });
    expect(upscaleSize({ width: 5000, height: 2000 }, 2, 'photo').tooLarge).toBe(true);
    expect(upscaleSize({ width: 5000, height: 2000 }, 2, 'anime').tooLarge).toBe(false);
    expect(upscaleRequest(blankForm('upscale'), [src('/a.png'), src('space:e1')], null, null)).toEqual({ inputs: ['/a.png', { entryId: 'e1' }], scale: 4, model: 'photo' });
  });

  it('放大：只提交这个模型收的参数，换模型前填的值不带上', () => {
    const engine = { providerId: 'google', modelId: 'gemini-3-pro-image' };
    const filled = { ...blankForm('upscale'), denoise: 2 as const, prompt: ' keep the paper ' };
    expect(upscaleRequest({ ...filled, model: 'remacri' }, [src('/a.png')], engine, '/out')).toEqual({
      inputs: ['/a.png'],
      scale: 4,
      model: 'remacri',
      outDir: '/out',
    });
    expect(upscaleRequest({ ...filled, model: 'waifu2x-photo', scale: 2 }, [src('/a.png')], engine, null)).toEqual({ inputs: ['/a.png'], scale: 2, model: 'waifu2x-photo', denoise: 2 });
    expect(upscaleRequest({ ...filled, model: 'generative' }, [src('/a.png')], engine, null)).toEqual({
      inputs: ['/a.png'],
      scale: 4,
      model: 'generative',
      provider: 'google',
      imageModel: 'gemini-3-pro-image',
      prompt: 'keep the paper',
    });
    // 中间先放大 4 倍的模型按 4 倍查上限；waifu2x 原生 2 倍，3、4 倍也按 4 倍查。
    expect(upscaleSize({ width: 5000, height: 2000 }, 2, 'remacri').tooLarge).toBe(true);
    expect(upscaleSize({ width: 5000, height: 2000 }, 2, 'waifu2x').tooLarge).toBe(false);
    expect(upscaleSize({ width: 5000, height: 2000 }, 2, 'lanczos').tooLarge).toBe(false);
  });

  it('放大的问题：缺的工具、生成式放大的模型与补充说明长度', () => {
    const empty = { boxes: [], strokes: [] };
    const form = blankForm('upscale');
    const ok = { upscaleTool: null, modelReason: 'no model' };
    expect(imageEditProblems('upscale', form, [src('/a.png')], empty, ok)).toEqual([]);
    expect(imageEditProblems('upscale', form, [src('/a.png')], empty, { ...ok, upscaleTool: 'Upscayl weights' })).toHaveLength(1);
    expect(imageEditProblems('upscale', { ...form, model: 'generative' }, [src('/a.png')], empty, ok)).toEqual(['no model']);
    const long = { ...form, model: 'generative' as const, prompt: 'x'.repeat(1001) };
    expect(imageEditProblems('upscale', long, [src('/a.png')], empty, { ...ok, modelReason: null })).toHaveLength(1);
  });

  it('选区：外框与覆盖率按格子算；工作区每边至少 512、不出界，盖满整张时整张发出去', () => {
    const sel = { boxes: [{ x: 1600, y: 900, width: 200, height: 64 }], strokes: [] };
    const stats = selectionStats(sel, { width: 2000, height: 1000 })!;
    expect(stats.bounds).toEqual({ x: 1600, y: 896, width: 208, height: 80 });
    expect(workArea(stats.bounds, { width: 2000, height: 1000 })).toEqual({ x: 1448, y: 488, width: 512, height: 512, full: false });
    expect(sendsWhole('watermark', sel, { width: 2000, height: 1000 })).toBe(false);
    expect(sendsWhole('watermark', { boxes: [{ x: 300, y: 250, width: 80, height: 30 }], strokes: [] }, { width: 400, height: 300 })).toBe(true);
    expect(sendsWhole('expand', sel, { width: 2000, height: 1000 })).toBe(true);
    expect(selectionStats({ boxes: [], strokes: [] }, { width: 10, height: 10 })).toBeNull();
  });

  it('扩图：按比例只往缺的方向加、按锚点放；按边扩换成像素；一边扩出超过原图一倍提醒分两次', () => {
    const base = { anchor: 'center' as const, margins: { left: 0, top: 0, right: 0, bottom: 0 } };
    expect(expandPlan({ width: 1000, height: 1000 }, { ...base, ratio: '16:9' })).toMatchObject({ width: 1778, height: 1000, x: 389, y: 0, same: false, staged: false });
    expect(expandPlan({ width: 1000, height: 1000 }, { ...base, ratio: '1:1' }).same).toBe(true);
    expect(expandPlan({ width: 1000, height: 1000 }, { ...base, ratio: '16:9', anchor: 'left' })).toMatchObject({ x: 0, added: { left: 0, right: 778 } });
    const free = expandPlan({ width: 1000, height: 500 }, { ...base, ratio: 'free', margins: { left: 60, top: 0, right: 60, bottom: 10 } });
    expect(free).toMatchObject({ width: 2200, height: 550, added: { left: 600, top: 0, right: 600, bottom: 50 }, staged: true });
  });

  it('表单检查：先选图；选区、提示词、模型不能用的原因各说一句', () => {
    const empty = { boxes: [], strokes: [] };
    const ctx = { upscaleTool: null, modelReason: null };
    expect(imageEditProblems('erase', blankForm('erase'), [], empty, ctx)).toHaveLength(1);
    expect(imageEditProblems('erase', blankForm('erase'), [src('/a.png')], empty, ctx)).toHaveLength(1);
    const sel = { boxes: [], strokes: [{ radius: 20, points: [[100, 100] as [number, number]] }] };
    expect(imageEditProblems('erase', blankForm('erase'), [src('/a.png')], sel, ctx)).toEqual([]);
    expect(imageEditProblems('repaint', blankForm('repaint'), [src('/a.png')], sel, ctx)).toHaveLength(1);
    expect(imageEditProblems('erase', blankForm('erase'), [src('/a.png')], sel, { ...ctx, modelReason: 'nope' })).toEqual(['nope']);
    expect(imageEditProblems('erase', { ...blankForm('erase'), method: 'fill' }, [src('/a.png')], sel, { ...ctx, modelReason: 'nope' })).toEqual([]);
    // 没有能改图的模型时，能快速填充的工具缺省快速填充。
    expect(blankForm('erase', false).method).toBe('fill');
    expect(blankForm('repaint', false).method).toBe('model');
  });

  it('提交参数：选区取整，扩图按边扩给像素，AI 修补带上选的模型；流程名对回工具', () => {
    const form = { ...blankForm('erase'), method: 'model' as const };
    const sel = { boxes: [], strokes: [{ radius: 20.4, points: [[10.6, 20.2] as [number, number]] }] };
    expect(editRequest('erase', form, [src('space:e1')], sel, { providerId: 'p', modelId: 'm' }, '/out')).toEqual({
      inputs: [{ entryId: 'e1' }],
      mask: { strokes: [{ radius: 20, points: [[11, 20]] }] },
      method: 'model',
      provider: 'p',
      model: 'm',
      outDir: '/out',
    });
    const expand = { ...blankForm('expand'), ratio: 'free' as const, margins: { left: 10, top: 0, right: 0, bottom: 0 }, prompt: ' sky ' };
    expect(editRequest('expand', expand, [src('/a.png')], { boxes: [], strokes: [] }, null, null)).toEqual({
      inputs: ['/a.png'],
      prompt: 'sky',
      expand: { margins: { left: 200, top: 0, right: 0, bottom: 0 } },
    });
    expect(imageEditToolOfPipeline('remove-watermark')).toBe('watermark');
    expect(imageEditToolOfPipeline('dub')).toBeNull();
  });
});
