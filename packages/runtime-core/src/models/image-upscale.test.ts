import { describe, expect, it } from 'vitest';
import type { ModelCatalog, ModelServices } from '@baocut/models';
import type { GrantService } from '../grants/grant-service.ts';
import { imageUpscaler } from './image-upscale.ts';

/** 生成式放大的模型选择：只在收参考图、列出像素尺寸的模型里选（不必能按提示词改图），给出它的像素尺寸。 */
describe('imageUpscaler.prepare', () => {
  it('收参考图（只作参考也行）、列出尺寸的才接受；显式指定的不行时 UPSCALE_MODEL_UNSUPPORTED', async () => {
    const calls: Array<{ target: unknown; accepts: ((model: unknown) => boolean) | undefined }> = [];
    let model: { referenceImages: { max: number; edit: boolean } | null; sizes: string[] } = {
      referenceImages: { max: 14, edit: false },
      sizes: ['1024x1024', '4096x4096', 'auto'],
    };
    const services = {
      selectGeneration: async (_capability: string, target: unknown, accepts?: (model: unknown) => boolean) => {
        calls.push({ target, accepts });
        return { providerId: 'google', modelId: 'gemini-3-pro-image', model };
      },
    };
    const upscaler = imageUpscaler({ services: services as unknown as ModelServices, grants: {} as GrantService, catalog: {} as ModelCatalog });
    await expect(upscaler.prepare({})).resolves.toEqual({ providerId: 'google', modelId: 'gemini-3-pro-image', sizes: ['1024x1024', '4096x4096'] });
    const accepts = calls[0]!.accepts!;
    expect(accepts({ referenceImages: { max: 1, edit: false }, sizes: ['1024x1024'] })).toBe(true);
    expect(accepts({ referenceImages: null, sizes: ['1024x1024'] })).toBe(false);
    expect(accepts({ referenceImages: { max: 1, edit: true }, sizes: ['auto'] })).toBe(false);

    model = { referenceImages: null, sizes: ['1024x1024'] };
    await expect(upscaler.prepare({ provider: 'google', model: 'imagen' })).rejects.toMatchObject({
      details: { code: 'UPSCALE_MODEL_UNSUPPORTED', modelId: 'gemini-3-pro-image' },
    });
    expect(calls[1]!.target).toEqual({ provider: 'google', model: 'imagen' });
    model = { referenceImages: { max: 1, edit: true }, sizes: [] };
    await expect(upscaler.prepare({})).rejects.toMatchObject({ details: { code: 'UPSCALE_MODEL_UNSUPPORTED' } });
  });
});
