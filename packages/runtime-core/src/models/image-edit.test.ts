import { describe, expect, it } from 'vitest';
import { localImageResources } from '@baocut/jobs';
import type { ModelCatalog, ModelServices } from '@baocut/models';
import type { GrantService } from '../grants/grant-service.ts';
import { closestSize, imageEditor } from './image-edit.ts';

/** AI 修补出图的尺寸：模型支持的尺寸里比例最接近工作区的，比例一样时取大的（至多 2048×2048）。 */
describe('closestSize', () => {
  const model = { sizes: ['1024x1024', '1536x1024', '1024x1536', '512x512', '4096x4096', 'auto'] };
  it('按比例挑；一样时取像素多的；不列尺寸时 null', () => {
    expect(closestSize(model, 512, 512)).toBe('1024x1024');
    expect(closestSize(model, 2000, 1200)).toBe('1536x1024');
    expect(closestSize(model, 600, 1000)).toBe('1024x1536');
    expect(closestSize({ sizes: [] }, 512, 512)).toBeNull();
  });
});

describe('imageEditor.resources', () => {
  it('本机模型包：同生成任务的 Worker 峰值加一张输入图，排模型包自己的队列；别的 Provider 不经资源调度', () => {
    const catalog = { imagePeak: () => ({ bytes: 8 * 2 ** 30, pool: 'gpuMemory' as const }), imageEditBytes: (_: string, n: number) => n * 2 ** 20 };
    const editor = imageEditor({ services: {} as ModelServices, grants: {} as GrantService, catalog: catalog as unknown as ModelCatalog });
    expect(editor.resources!({ providerId: 'local', modelId: 'flux-kontext' })).toEqual({
      ...localImageResources('flux-kontext', catalog.imagePeak(), 2 ** 20),
      queue: { key: 'flux-kontext', concurrency: 1 },
    });
    expect(editor.resources!({ providerId: 'acme', modelId: 'edit-1' })).toBeNull();
  });
});

describe('imageEditor.prepare', () => {
  it('选择时只接受能改图的模型（没指定模型时由选择规则换）；选到不能改图的（显式指定）时 IMAGE_EDIT_UNSUPPORTED', async () => {
    const calls: Array<{ target: unknown; accepts: ((model: unknown) => boolean) | undefined }> = [];
    let model: { referenceImages: { max: number; edit: boolean } | null } = { referenceImages: { max: 1, edit: true } };
    const services = {
      selectGeneration: async (_capability: string, target: unknown, accepts?: (model: unknown) => boolean) => {
        calls.push({ target, accepts });
        return { providerId: 'openai', modelId: 'gpt-image-2', model };
      },
    };
    const editor = imageEditor({ services: services as unknown as ModelServices, grants: {} as GrantService, catalog: {} as ModelCatalog });
    await expect(editor.prepare({})).resolves.toEqual({ providerId: 'openai', modelId: 'gpt-image-2' });
    expect(calls[0]!.target).toEqual({});
    expect(calls[0]!.accepts?.({ referenceImages: { max: 1, edit: true } })).toBe(true);
    expect(calls[0]!.accepts?.({ referenceImages: { max: 4, edit: false } })).toBe(false);
    expect(calls[0]!.accepts?.({ referenceImages: null })).toBe(false);

    model = { referenceImages: null };
    await expect(editor.prepare({ model: 'gemini-x' })).rejects.toMatchObject({ details: { code: 'IMAGE_EDIT_UNSUPPORTED', modelId: 'gpt-image-2' } });
    expect(calls[1]!.target).toEqual({ model: 'gemini-x' });
  });
});
