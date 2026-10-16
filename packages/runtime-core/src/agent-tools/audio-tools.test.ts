import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { editorWasmAvailable, sfxRecipes, sfxRender } from '@baocut/editor-wasm';
import { ANALYSIS_DIR, AudioTools, MAX_SHEET_SECONDS, SFX_RECIPES } from './audio-tools.ts';
import type { ToolPrincipal, ToolScope } from './tool-scope.ts';

/** `assets_analyze` 走真的 ffmpeg 解码与编辑语义 WASM；`assets_sfx` 的配方表与 WASM 里的一致。 */

const ffmpeg = process.env.BAOCUT_FFMPEG ?? 'ffmpeg';
const ready = editorWasmAvailable() && spawnSync(ffmpeg, ['-version']).status === 0;

const agent = { kind: 'agent' } as unknown as ToolPrincipal;
let dir: string;

function tools() {
  const video = { assets: {}, rootSequenceId: 's', sequences: { s: { fps: { num: 30, den: 1 }, items: [] } } };
  const scope = {
    authorize: (principal: ToolPrincipal) => ({ principal }),
    saveRoot: () => dir,
    importBase: () => ({ cwd: dir, confine: null }),
    open: async () => ({ ref: { videoId: 'v1' }, snapshot: { video } }),
  } as unknown as ToolScope;
  return new AudioTools({ videos: { mirror: () => undefined } as never, scope, ffmpeg: () => ffmpeg });
}

/** 四下 kick，每 0.5 秒一下，写成工作目录里的 kicks.wav（起音在 0.5、1、1.5 秒）。 */
async function writeKicks(): Promise<void> {
  const kick = sfxRender({ recipe: 'kick', seconds: 0.5 });
  const parts = await Promise.all(
    [0, 1, 2, 3].map(async (n) => {
      const file = path.join(dir, `kick-${n}.wav`);
      await fs.writeFile(file, kick);
      return file;
    }),
  );
  const concat = spawnSync(ffmpeg, [
    '-v',
    'error',
    ...parts.flatMap((file) => ['-i', file]),
    '-filter_complex',
    'concat=n=4:v=0:a=1',
    '-y',
    path.join(dir, 'kicks.wav'),
  ]);
  expect(concat.status, String(concat.stderr)).toBe(0);
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-audio-tools-'));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe.skipIf(!ready)('audio tools', () => {
  it('lists the same recipes as the DSP crate', () => {
    expect(sfxRecipes().map((r) => r.name)).toEqual([...SFX_RECIPES]);
  });

  it('analyzes a file in the working directory and writes the full result', async () => {
    await writeKicks();

    const result = (await tools().dispatch('assets_analyze', { video: 'demo', path: 'kicks.wav', beats: false }, agent)) as {
      file: string;
      fps: number;
      frameCount: number;
      onsets: Array<{ t: number }>;
      beats: unknown;
    };
    expect(result.fps).toBe(30);
    expect(result.frameCount).toBe(60);
    // 第一下在 0 秒：没有之前的帧可比，不算起音；其余三下落在 ±20 ms 里。
    expect(result.onsets.map((o) => Math.round(o.t * 50) / 50)).toEqual([0.5, 1, 1.5]);
    expect(result.beats).toBeNull();
    expect(path.relative(await fs.realpath(dir), result.file)).toBe(path.join(ANALYSIS_DIR, 'v1', 'kicks.json'));
    const saved = JSON.parse(await fs.readFile(result.file, 'utf8')) as { schema: string; frames: { level: number[] } };
    expect(saved.schema).toBe('baocut.audio-analysis/1');
    expect(saved.frames.level).toHaveLength(60);
  });

  it('checks cues in source-file seconds and draws a listening sheet', async () => {
    await writeKicks();
    const args = { video: 'demo', path: 'kicks.wav', range: '0.25:2', beats: false, cues: [1.01, 1.6, 0.8, 0.1], sheet: true };
    const result = (await tools().dispatch('assets_analyze', args, agent)) as {
      file: string;
      sheet: string;
      accentCount: number;
      sync: {
        inside: number;
        ok: number;
        outside: number;
        hitRate: number;
        chance: number;
        misses: Array<{ t: number; delta: number | null; status: string }>;
      };
    };
    // 1.01 对上 1 秒的起音；1.6 离 1.5 秒 0.1 秒，差一点；0.8 附近没有；0.1 在 range 之前。
    expect(result.sync).toMatchObject({ inside: 3, ok: 1, outside: 1 });
    expect(result.sync.misses.map((m) => [m.t, m.status])).toEqual([
      [1.6, 'near'],
      [0.8, 'none'],
      [0.1, 'outside'],
    ]);
    expect(result.sync.misses[0]!.delta).toBeLessThan(0);
    expect(result.sync.chance).toBeGreaterThan(0);
    expect(result.sync.chance).toBeLessThan(0.2);
    expect(result.accentCount).toBeGreaterThan(0);
    const saved = JSON.parse(await fs.readFile(result.file, 'utf8')) as { sync: { cues: Array<{ t: number }> } };
    expect(saved.sync.cues.map((c) => c.t)).toEqual(args.cues);

    expect(result.sheet).toBe(result.file.replace(/\.json$/, '.png'));
    const png = await fs.readFile(result.sheet);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1600);

    await expect(
      tools().dispatch('assets_analyze', { video: 'demo', path: 'kicks.wav', range: `0:${MAX_SHEET_SECONDS + 1}`, sheet: true }, agent),
    ).rejects.toMatchObject({ code: 'AUDIO_SHEET_TOO_LONG' });
  });

  it('reports a file with no audio and needs exactly one source', async () => {
    const still = path.join(dir, 'still.png');
    expect(spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', '-y', still]).status).toBe(0);
    await expect(tools().dispatch('assets_analyze', { video: 'demo', path: 'still.png' }, agent)).rejects.toMatchObject({
      code: 'AUDIO_NO_STREAM',
    });
    await expect(tools().dispatch('assets_analyze', { video: 'demo' }, agent)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
  });
});
