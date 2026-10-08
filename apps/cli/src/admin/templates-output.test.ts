import { describe, expect, it } from 'vitest';
import type { TemplateManifest, TemplateSummary } from '@baocut/protocol';
import { formatTemplateDetail, formatTemplateList, parseChatTemplate } from './templates-output.ts';

const manifest: TemplateManifest = {
  schema: 1,
  id: 'launch-film',
  version: '1.0.0',
  kind: 'scene',
  title: '新品发布片',
  summary: '一句话。',
  description: '一小段。',
  language: 'zh-CN',
  category: 'product-launch',
  ratio: '16:9',
  durationSeconds: 60,
  brief: '给{{新产品}}做一条发布片。',
  fields: [{ label: '新产品', example: '一款台灯' }],
  author: 'BaoCut',
  source: 'official',
  license: 'Apache-2.0',
  tags: ['发布'],
  cover: { file: 'cover.png', tone: 'blue' },
  preview: { beats: ['一', '二', '三'] },
  assets: [{ path: 'assets/logo.svg', type: 'svg', note: '片尾标志' }],
};
const scene: TemplateSummary = { manifest, origin: 'builtin', files: { cover: true, preview: false, assets: 1 } };
const { ratio: _r, durationSeconds: _d, brief: _b, fields: _f, ...loose } = manifest;
const example: TemplateSummary = {
  manifest: { ...loose, id: 'an-example', kind: 'example', title: '示例' },
  origin: 'user',
  files: { cover: true, preview: false, assets: 1 },
};

describe('baocut templates 的输出', () => {
  it('场景模板在前；跳过的模板列在最后，带原因与目录', () => {
    const lines = formatTemplateList({
      templates: [example, scene],
      diagnostics: [
        {
          code: 'invalid',
          origin: 'user',
          dir: 'broken',
          path: '/tmp/home/templates/broken',
          message: '模板不合规，没有加载',
          issues: ['缺少 prompt.md'],
        },
      ],
    });
    expect(lines[0]).toBe('launch-film  场景模板  内置  16:9 · 60 秒  新品发布片：一句话。');
    expect(lines[1]).toBe('an-example  作品示例  用户  画幅自动 · 时长自动  示例：一句话。');
    expect(lines.slice(2)).toEqual([
      '',
      '跳过了 1 个模板目录：',
      '用户模板 broken（invalid）：模板不合规，没有加载\n  - 缺少 prompt.md\n  目录：/tmp/home/templates/broken',
    ]);
    expect(formatTemplateList({ templates: [], diagnostics: [] })).toEqual(['没有可用的模板']);
  });

  it('show 打印清单要点与提示词全文', () => {
    const lines = formatTemplateDetail({ template: scene, prompt: '你要做一条视频。\n' });
    expect(lines[0]).toBe('新品发布片（launch-film v1.0.0，场景模板，内置）');
    expect(lines).toContain('可以这样说：给一款台灯做一条发布片。');
    expect(lines).toContain('封面：cover.png');
    expect(lines).toContain('素材：assets/logo.svg（svg）片尾标志');
    expect(lines.slice(-2)).toEqual(['--- prompt.md ---', '你要做一条视频。']);

    const verification = {
      date: '2026-10-04',
      version: '1.0.0',
      engine: 'codex',
      input: '按提示词原样。',
      materials: [],
      capabilities: ['synthesizeSpeech' as const],
      outcome: 'partial' as const,
      output: { ratio: '16:9', durationSeconds: 15 },
      notes: '没有旁白。',
    };
    const checked = formatTemplateDetail({ template: { ...scene, manifest: { ...manifest, verification } }, prompt: '正文' });
    expect(checked).toContain('验证：2026-10-04 codex v1.0.0 partial，成片 16:9 · 15 秒，缺 synthesizeSpeech');
  });

  it('chat --template 只带 id，不是 kebab-case 时本地拒绝', () => {
    expect(parseChatTemplate(undefined)).toBeUndefined();
    expect(parseChatTemplate('data-story')).toEqual({ id: 'data-story' });
    expect(parseChatTemplate(' data-story ')).toEqual({ id: 'data-story' });
    for (const bad of ['', 'Data-Story', 'data_story', '../x']) expect(() => parseChatTemplate(bad), bad).toThrow(/--template/);
  });
});
