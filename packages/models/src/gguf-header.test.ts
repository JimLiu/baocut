import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readGgufHeader } from './gguf-header.ts';
import { ggufBytes } from './testing/gguf-bytes.ts';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gguf-header-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function header(bytes: Buffer) {
  const file = path.join(dir, 'm.gguf');
  await fs.writeFile(file, bytes);
  const handle = await fs.open(file, 'r');
  try {
    const h = await readGgufHeader(handle);
    return { name: h.name, family: h.family, config: (await h.embedded('config.json'))?.toString('utf8') ?? null, readme: await h.embedded('README.md') };
  } finally {
    await handle.close();
  }
}

describe('GGUF 文件头', () => {
  it('读出名字、模型族与打包进去的 config.json，跳过别的键与长数组', async () => {
    const config = '{"tts_model_type":"base"}';
    const data = Buffer.concat([Buffer.from('readme!'), Buffer.from(config)]);
    const got = await header(
      ggufBytes([
        ['general.architecture', 'audiocpp'],
        ['general.name', 'Qwen3-TTS-12Hz-0.6B-Base'],
        ['audiocpp.model_spec.version', 1],
        ['audiocpp.model_spec.family', 'qwen3_tts'],
        ['audiocpp.embedded_files.names', { strings: ['README.md', 'config.json'] }],
        ['audiocpp.embedded_files.offsets', { u64: [0, 7, data.length] }],
        ['audiocpp.embedded_files.data', { bytes: data }],
        ['audiocpp.tensor_names', { strings: Array.from({ length: 3000 }, (_, i) => `tensor.${i}.weight`) }],
      ]),
    );
    expect(got).toEqual({ name: 'Qwen3-TTS-12Hz-0.6B-Base', family: 'qwen3_tts', config, readme: Buffer.from('readme!') });
  });

  it('没有这些键时给 null；截断的文件头报错', async () => {
    expect(await header(ggufBytes([['general.architecture', 'llama']]))).toEqual({ name: null, family: null, config: null, readme: null });
    const full = ggufBytes([['general.name', 'x'.repeat(100)]]);
    await expect(header(full.subarray(0, full.length - 10))).rejects.toThrow(/truncated/);
  });
});
