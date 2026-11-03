import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type ToolInspectInputsResult } from '@baocut/protocol';
import { resolvePipelineEntryInputs } from '../space/space-inputs.ts';
import { toolCatalogueMethods, type ToolCatalogueDeps } from './tool-methods.ts';

/** `tools.inspectInputs`（架构设计 §7.9）：读文件的事实，单个输入读不出不让整次失败；统一色调的参考也能是 Space 条目。 */

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('tools.inspectInputs', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-inspect-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const handlers = (resolveFile: (entryId: string) => { entry: { name: string }; file: string }, mediaTools?: ToolCatalogueDeps['mediaTools']) =>
    toolCatalogueMethods({
      space: { resolveFile } as unknown as ToolCatalogueDeps['space'],
      services: {} as ToolCatalogueDeps['services'],
      externalTools: () => {
        throw new Error('not used');
      },
      offlineStrict: () => false,
      mediaTools: mediaTools ?? {
        ffmpeg: async () => ({ command: 'ffmpeg', env: process.env }),
        ffprobe: async () => ({ command: 'ffprobe', env: process.env }),
      },
    });
  const inspect = (h: ReturnType<typeof handlers>, params: { inputs: Array<string | { entryId: string }>; stabilizer?: boolean }) =>
    Promise.resolve((h['tools.inspectInputs'] as unknown as (p: typeof params) => ToolInspectInputsResult | Promise<ToolInspectInputsResult>)(params));

  it('读不出的只算那一项：文件不在、条目不能用', async () => {
    const h = handlers(() => {
      throw new RpcError('conflict', { text: 'gone' } as never);
    });
    const { items, stabilizer } = await inspect(h, { inputs: [path.join(dir, 'nope.mp4'), { entryId: 'ent_1' }] });
    expect(items).toEqual([
      expect.objectContaining({ name: 'nope.mp4', kind: 'unreadable' }),
      expect.objectContaining({ name: 'ent_1', kind: 'unreadable' }),
    ]);
    expect(stabilizer).toBeUndefined();
  });

  it('相对路径不读（同流程的 inputs）', async () => {
    const h = handlers(() => ({ entry: { name: 'x' }, file: 'x' }));
    const { items } = await inspect(h, { inputs: ['package.json'] });
    expect(items).toEqual([expect.objectContaining({ name: 'package.json', kind: 'unreadable', bytes: null })]);
  });

  it('ffmpeg 不能用时去抖的滤镜是 null，空输入也能问', async () => {
    const missing = async () => ({ command: 'baocut-no-such-ffmpeg', env: process.env });
    const h = handlers(() => ({ entry: { name: 'x' }, file: 'x' }), { ffmpeg: missing, ffprobe: missing });
    expect(await inspect(h, { inputs: [], stabilizer: true })).toEqual({ items: [], stabilizer: null });
  });

  it.skipIf(!hasFfmpeg)('Space 条目换成它的文件，名字用条目的', async () => {
    const png = path.join(dir, 'still.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:size=64x32', '-frames:v', '1', png]);
    const h = handlers((entryId) => ({ entry: { name: `条目 ${entryId}` }, file: png }));
    const { items } = await inspect(h, { inputs: [{ entryId: 'ent_1' }] });
    expect(items[0]).toMatchObject({ name: '条目 ent_1', kind: 'image', width: 64, height: 32 });
  });
});

describe('素材处理的 Space 输入', () => {
  const space = { resolveFile: (entryId: string) => ({ entry: { id: entryId } as never, file: `/space/${entryId}` }) };
  it('统一色调的参考与 inputs 一样换成文件', () => {
    expect(resolvePipelineEntryInputs(space, 'match-color', { inputs: [{ entryId: 'a' }, '/b.mp4'], reference: { entryId: 'r' } })).toEqual({ inputs: ['/space/a', '/b.mp4'], reference: '/space/r' });
    expect(resolvePipelineEntryInputs(space, 'match-color', { inputs: ['/b.mp4'], reference: '/r.png' })).toEqual({ inputs: ['/b.mp4'], reference: '/r.png' });
    expect(resolvePipelineEntryInputs(space, 'stabilize-video', { inputs: [{ entryId: 'a' }] })).toEqual({ inputs: ['/space/a'] });
  });
});
