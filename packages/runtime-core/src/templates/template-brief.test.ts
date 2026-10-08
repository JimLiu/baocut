import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TemplateManifest } from '@baocut/protocol';
import { SCENE_BRIEF_PREAMBLE, resolveSceneTemplate } from './template-brief.ts';
import { TemplateCatalog } from './template-catalog.ts';

const scene: TemplateManifest = {
  schema: 1,
  id: 'launch-scene',
  version: '1.2.0',
  kind: 'scene',
  title: '发布短片',
  summary: '一句话。',
  description: '一小段。',
  language: 'zh-CN',
  category: 'product-launch',
  ratio: '9:16',
  durationSeconds: 45,
  brief: '给{{新产品}}做一条发布片。',
  fields: [{ label: '新产品', example: '一款台灯' }],
  skills: ['video-production', 'narration'],
  author: 'BaoCut',
  source: 'official',
  license: 'Apache-2.0',
  tags: [],
  cover: { tone: 'blue', figure: 'bars' },
  preview: { beats: ['一', '二', '三'] },
  assets: [
    { path: 'assets/logo.svg', type: 'svg', note: '片尾标志' },
    { path: 'assets/bgm.mp3', type: 'audio', note: '背景音乐，约 30 秒' },
  ],
};

const { ratio: _r, durationSeconds: _d, brief: _b, fields: _f, skills: _k, assets: _a, ...rest } = scene;
const example: TemplateManifest = { ...rest, id: 'an-example', kind: 'example' };

let root: string;
let catalog: TemplateCatalog;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-template-brief-'));
  for (const m of [scene, example]) {
    const dir = path.join(root, m.id);
    await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'template.json'), JSON.stringify(m));
    await fs.writeFile(path.join(dir, 'prompt.md'), `你要做一条${m.title}。\n`);
    for (const a of m.assets ?? []) await fs.writeFile(path.join(dir, a.path), 'x');
  }
  catalog = new TemplateCatalog({ builtinDir: root, userDir: path.join(root, 'none') });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('简报引导前言', () => {
  it('十条都在，并要求用用户的语言、不设默认的成片语言、缺能力时降级并说明、先读做法、没填的待填项当缺项问', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(SCENE_BRIEF_PREAMBLE).toContain(`${n}. `);
    expect(SCENE_BRIEF_PREAMBLE).toContain('确认之前不开始制作');
    expect(SCENE_BRIEF_PREAMBLE).toContain('主题');
    expect(SCENE_BRIEF_PREAMBLE).toContain('受众');
    expect(SCENE_BRIEF_PREAMBLE).toContain('合并成一轮提问');
    expect(SCENE_BRIEF_PREAMBLE).toContain('用用户的语言提问和回复');
    expect(SCENE_BRIEF_PREAMBLE).toContain('不把任何一种语言设为成片的默认语言');
    expect(SCENE_BRIEF_PREAMBLE).toContain('以用户确认的简报为准');
    expect(SCENE_BRIEF_PREAMBLE).toContain('没有语音合成就用字幕');
    expect(SCENE_BRIEF_PREAMBLE).toContain('写明哪些要求因此降级');
    expect(SCENE_BRIEF_PREAMBLE).toContain('skills_read 读 video-production');
    expect(SCENE_BRIEF_PREAMBLE).toContain('「[受众]」');
    expect(SCENE_BRIEF_PREAMBLE).toContain('归入简报缺项');
  });
});

describe('发送时解析场景模板', () => {
  it('拼出前言、默认值、正文与全部素材；标记记下实际的版本', async () => {
    const resolved = await resolveSceneTemplate(catalog, { id: 'launch-scene', version: '0.9.0' });
    expect(resolved.ref).toEqual({ id: 'launch-scene', version: '1.2.0', title: '发布短片', kind: 'scene', origin: 'builtin' });
    const text = resolved.instructions;
    expect(text.startsWith('<baocut-template id="launch-scene" version="1.2.0">')).toBe(true);
    expect(text.endsWith('</baocut-template>')).toBe(true);
    expect(text).toContain('用户选了场景模板「发布短片」。');
    expect(text).toContain(SCENE_BRIEF_PREAMBLE);
    expect(text).toContain(
      '模板默认值：画幅 9:16，时长 45 秒。\n这个模板建议先读的做法：video-production、narration（用 skills_read 读）。',
    );
    expect(text).toContain('模板正文：\n你要做一条发布短片。');
    expect(text.indexOf(SCENE_BRIEF_PREAMBLE)).toBeLessThan(text.indexOf('模板正文'));
    expect(text).toContain(`- ${JSON.stringify(path.join(root, 'launch-scene', 'assets', 'logo.svg'))}（svg）：片尾标志`);
    expect(text).toContain('（audio）：背景音乐，约 30 秒');
  });

  it('模板没给 skills 时不列做法', async () => {
    const { skills: _s, ...noSkills } = scene;
    await fs.writeFile(path.join(root, scene.id, 'template.json'), JSON.stringify(noSkills));
    const resolved = await resolveSceneTemplate(catalog, { id: 'launch-scene' });
    expect(resolved.instructions).not.toContain('这个模板建议先读的做法：');
  });

  it('assets 只附用户留下的；空数组一项也不附', async () => {
    const one = await resolveSceneTemplate(catalog, { id: 'launch-scene', assets: ['assets/bgm.mp3'] });
    expect(one.instructions).toContain('bgm.mp3');
    expect(one.instructions).not.toContain('logo.svg');
    const none = await resolveSceneTemplate(catalog, { id: 'launch-scene', assets: [] });
    expect(none.instructions).not.toContain('模板随附的素材');
  });

  it('没登记的素材、作品示例与不存在的模板被拒绝', async () => {
    await expect(resolveSceneTemplate(catalog, { id: 'launch-scene', assets: ['assets/other.svg'] })).rejects.toMatchObject({
      code: 'invalid-request',
      details: { code: 'TEMPLATE_FILE_NOT_FOUND' },
    });
    await expect(resolveSceneTemplate(catalog, { id: 'an-example' })).rejects.toMatchObject({
      code: 'invalid-request',
      details: { code: 'TEMPLATE_NOT_SCENE', kind: 'example' },
    });
    await expect(resolveSceneTemplate(catalog, { id: 'missing' })).rejects.toMatchObject({
      code: 'not-found',
      details: { code: 'TEMPLATE_NOT_FOUND' },
    });
  });
});
