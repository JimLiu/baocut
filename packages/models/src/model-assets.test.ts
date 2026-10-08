import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MODEL_ASSETS_ENV, modelAssetPath, resolveModelAssetsDir } from './model-assets.ts';
import { TRANSCRIBE_SELF_TEST, selfTestSampleFile } from './self-test-sample.ts';
import { BUILTIN_VOICES, builtinVoiceFile } from './speech-voices.ts';

const SOURCE_ASSETS = fileURLToPath(new URL('../assets', import.meta.url));

describe('随应用分发的模型数据', () => {
  const temps: string[] = [];
  const process_ = process as { resourcesPath?: string };
  const originalResources = process_.resourcesPath;

  afterEach(() => {
    if (originalResources === undefined) delete process_.resourcesPath;
    else process_.resourcesPath = originalResources;
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function temp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-model-assets-'));
    temps.push(dir);
    return dir;
  }

  it('源码布局：从模块往上找到仓库里的 packages/models/assets', () => {
    expect(resolveModelAssetsDir({})).toBe(SOURCE_ASSETS);
  });

  it('自测样本与目录里每只内置音色的录音都解析成存在的文件', () => {
    const sample = selfTestSampleFile(TRANSCRIBE_SELF_TEST, {});
    expect(sample).toBe(path.join(SOURCE_ASSETS, 'self-test-sample.wav'));
    expect(fs.statSync(sample!).isFile()).toBe(true);
    expect(BUILTIN_VOICES.length).toBeGreaterThan(0);
    for (const voice of BUILTIN_VOICES) {
      const file = builtinVoiceFile(voice, {});
      expect(file, voice.id).not.toBeNull();
      expect(fs.statSync(file!).isFile(), voice.id).toBe(true);
    }
  });

  it('环境变量优先，在调用时读；目录里缺文件时照样给出路径，由读的地方报缺失', () => {
    const dir = temp();
    const env = { [MODEL_ASSETS_ENV]: dir };
    expect(resolveModelAssetsDir(env)).toBe(dir);
    expect(modelAssetPath('tts-voices/zh-female.wav', env)).toBe(path.join(dir, 'tts-voices', 'zh-female.wav'));
    expect(fs.existsSync(selfTestSampleFile(TRANSCRIBE_SELF_TEST, env)!)).toBe(false);
  });

  it('打包后的应用：资源目录里的 model-assets 先于仓库', () => {
    const resources = temp();
    process_.resourcesPath = resources;
    expect(resolveModelAssetsDir({})).toBe(SOURCE_ASSETS);
    fs.mkdirSync(path.join(resources, 'model-assets'));
    expect(resolveModelAssetsDir({})).toBe(path.join(resources, 'model-assets'));
  });
});
