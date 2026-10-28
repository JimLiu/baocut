import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PACKAGES,
  addableFamilies,
  catalogBundle,
  catalogFamily,
  customFamilies,
  genericSpeechProfile,
  idleReason,
  localFileBundle,
  repoFileBundle,
} from './audio-cpp-catalog.ts';
import { BUNDLES } from './bundle-registry.ts';
import type { SpeechParameters } from './generation-options.ts';
import { audioCppSpeechRequestOf } from './local-speech.ts';

const families = addableFamilies(new Set());
const addable = families.flatMap((f) => f.packages.filter((p) => p.state === null).map((p) => ({ family: f, pkg: p })));

describe('audio.cpp 模型目录', () => {
  it('分组：合成与 YuE2 能加，别的音乐模型、识别、分离与其余任务暂时用不上，各有原因', () => {
    expect(families.filter((f) => f.group === 'music').map((f) => f.family)).toEqual(['yue2']);
    const reasons = new Set(families.filter((f) => f.group === 'idle').map((f) => f.idle));
    expect([...reasons].sort()).toEqual(['engine-route', 'music-request', 'other', 'recognize', 'separate']);
    expect(idleReason(catalogFamily('moss_voicegen')!)).toBe('engine-route');
    expect(families.filter((f) => f.group === 'idle').every((f) => f.packages.length === 0)).toBe(true);
    expect(families.filter((f) => f.group === 'tts').length).toBeGreaterThan(40);
  });

  it('内置的包指向登记的模型包，不能再加', () => {
    const ids = new Set(BUNDLES.map((b) => b.bundleId));
    for (const [pkg, bundleId] of Object.entries(BUILTIN_PACKAGES)) {
      expect(ids.has(bundleId), bundleId).toBe(true);
      expect(catalogBundle(pkg)).toBeNull();
    }
    const yue = families.find((f) => f.family === 'yue2')!;
    expect(yue.packages.find((p) => p.id === 'yue2_main_q8_0')).toMatchObject({ state: 'builtin', bundleId: 'yue2-3b@audio-cpp-q8' });
    expect(addableFamilies(new Set(['yue2-main-bf16@audio-cpp'])).find((f) => f.family === 'yue2')!.packages.find((p) => p.id === 'yue2_main_bf16')!.state).toBe('added');
  });

  it('每个能加的包都变成一个模型包：ID 不与内置的重名，清单的大小与目录给的一致，带完整的 sha256', () => {
    const builtin = new Set(BUNDLES.map((b) => b.bundleId));
    const seen = new Set<string>();
    for (const { pkg } of addable) {
      const bundle = catalogBundle(pkg.id)!;
      expect(bundle, pkg.id).not.toBeNull();
      const id = bundle.definition.bundleId;
      expect(id).toBe(pkg.bundleId);
      expect(builtin.has(id) || seen.has(id), id).toBe(false);
      seen.add(id);
      expect(bundle.manifest!.estimatedBytes).toBe(pkg.bytes);
      expect(bundle.manifest!.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256 ?? '') && (f.size ?? 0) > 0)).toBe(true);
      expect(bundle.info).toMatchObject({ kind: 'catalog', source: pkg.id });
      expect(bundle.definition.backend).toBe('audio-cpp');
    }
  });

  it('YuE2 别的精度带上 VAE，权重文件换成这个包的', () => {
    const bundle = catalogBundle('yue2_main_bf16')!;
    expect(bundle.definition.capability).toBe('music');
    expect(bundle.manifest!.files.map((f) => f.path).some((p) => /vae/i.test(p))).toBe(true);
    expect(bundle.definition.music!.files.model).toMatch(/bf16/i);
    expect(bundle.manifest!.files.map((f) => f.path)).toContain(bundle.definition.music!.files.vae);
  });

  it('一个文件的包交给引擎那个文件，多个文件的交给包的根目录', () => {
    const one = addable.find(({ pkg }) => catalogBundle(pkg.id)!.manifest!.files.length === 1)!;
    const single = catalogBundle(one.pkg.id)!;
    expect(single.definition.speech!.engine.file).toBe(single.manifest!.files[0]!.path);
    const multi = catalogBundle('pocket_tts_german_q8_0') ?? null;
    if (multi && multi.manifest!.files.length > 1) expect(multi.definition.speech!.engine.file).not.toMatch(/\.gguf$/);
  });

  it('许可：可商用 true，不可商用 false，有条件或不明 null', () => {
    const values = new Set(families.map((f) => f.license.commercialUse));
    expect(values).toEqual(new Set([true, false, null]));
    expect(families.find((f) => f.family === 'yue2')!.license.commercialUse).toBe(false);
    for (const f of families) expect(f.license.summary.length).toBeGreaterThan(0);
  });

  it('合成特性按规格：说话人、克隆、描述与只发规格里的请求参数', () => {
    for (const { family } of addable) {
      const fam = catalogFamily(family.family)!;
      if (fam.group !== 'tts') continue;
      const profile = genericSpeechProfile(fam, 'x.gguf', 1);
      expect(profile.engine.options).toEqual(fam.request.options);
      expect(profile.voiceModes[0]).toBe('preset');
      if (profile.presets === 'model') expect(profile.speakers!.length).toBeGreaterThan(0);
      expect(profile.voiceModes.includes('clone')).toBe(fam.traits.clone === true);
      if (profile.voiceModes.includes('describe')) expect(fam.request.options).toContain('instruct');
    }
  });

  it('自己指定的文件只能按能加的合成模型族加，许可待核实', () => {
    expect(customFamilies().every((f) => f.group === 'tts' && idleReason(f) === null)).toBe(true);
    const repo = repoFileBundle({ family: 'qwen3_tts', repo: 'me/voice', revision: 'a'.repeat(40), path: 'v.gguf', size: 9, sha256: 'b'.repeat(64), label: 'v' }, 'custom-1@audio-cpp')!;
    expect(repo.definition.license!.commercialUse).toBeNull();
    expect(repo.manifest).toMatchObject({ sourceRepo: 'me/voice', files: [{ path: 'v.gguf', size: 9 }] });
    expect(repo.info).toEqual({ kind: 'repo-file', family: 'qwen3_tts', familyName: catalogFamily('qwen3_tts')!.name, source: 'me/voice/v.gguf' });
    const local = localFileBundle({ family: 'qwen3_tts', path: '/a/b/v.gguf', size: 9, label: 'v' }, 'custom-2@audio-cpp')!;
    expect(local.manifest).toBeNull();
    expect(local.definition.components.tts).toMatchObject({ revision: 'local', local: { path: '/a/b/v.gguf', size: 9 } });
    expect(local.definition.speech!.engine.file).toBe('v.gguf');
    expect(localFileBundle({ family: 'yue2', path: '/a.gguf', size: 1, label: 'a' }, 'custom-3@audio-cpp')).toBeNull();
  });

  it('添加的模型只发规格列出的请求参数：规格没有的语速、风格说明不发', () => {
    const fam = addable.map(({ family }) => catalogFamily(family.family)!).find((f) => !f.request.options.includes('speed') && !f.request.options.includes('instruct'))!;
    const profile = genericSpeechProfile(fam, 'x.gguf', 1);
    const parameters = { capability: 'synthesizeSpeech', text: 'hi', voice: profile.speakers?.[0] ?? 'default', language: null, instructions: 'calm', speed: 1.2, seed: 3, reference: null } as unknown as SpeechParameters;
    const { body } = audioCppSpeechRequestOf(parameters, profile, null);
    expect(body.options).not.toHaveProperty('speed');
    expect(body.options).not.toHaveProperty('instruct');
    expect(body.seed).toBe(3);
    for (const key of Object.keys(body.options)) expect(fam.request.options).toContain(key);
  });
});
