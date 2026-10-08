import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { methodParamSchemas } from './schemas.ts';
import { parseTemplateManifest, templateManifestSchema, templateSendRefSchema } from './template-schemas.ts';
import {
  TEMPLATE_FILE_MAX_BYTES,
  TEMPLATE_LIMITS,
  TEMPLATE_MANIFEST_FILE,
  TEMPLATE_PROMPT_FILE,
  templateExampleText,
  templatePathProblem,
  templatePromptSlotProblems,
  templateSlotProblems,
  templateSlots,
  templateUnfilledText,
  type TemplateManifest,
  type TemplateVerification,
} from './template.ts';

/** 仓库根下的 `templates/`：从本文件往上三级（packages/protocol/src）。 */
const TEMPLATES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates');

const base: TemplateManifest = {
  schema: 1,
  id: 'sample-scene',
  version: '1.0.0',
  kind: 'scene',
  title: '示例',
  summary: '一句话。',
  description: '一小段。',
  language: 'zh-CN',
  category: 'explainer',
  ratio: '16:9',
  durationSeconds: 60,
  brief: '给 {{主题}} 做一条讲解，受众是 {{受众}}。',
  fields: [
    { label: '主题', hint: '讲什么', example: '光合作用' },
    { label: '受众', example: '高中生' },
  ],
  skills: ['video-production', 'narration'],
  author: 'BaoCut',
  source: 'official',
  license: 'Apache-2.0',
  tags: ['讲解'],
  cover: { tone: 'blue', figure: 'steps', kicker: '01' },
  preview: { beats: ['一', '二', '三'] },
};

describe('模板清单的校验', () => {
  it('合规的场景模板与作品示例', () => {
    expect(parseTemplateManifest(base, 'sample-scene')).toEqual({ ok: true, manifest: base });
    const { ratio: _r, durationSeconds: _d, brief: _b, ...rest } = base;
    expect(templateManifestSchema.safeParse({ ...rest, kind: 'example' }).success).toBe(true);
  });

  it('场景模板必须给画幅、时长与 brief；作品示例不得有 brief', () => {
    expect(templateManifestSchema.safeParse({ ...base, kind: 'example' }).success).toBe(false);
    for (const key of ['ratio', 'durationSeconds', 'brief'] as const) {
      const { [key]: _omit, ...rest } = base;
      expect(templateManifestSchema.safeParse(rest).success, key).toBe(false);
    }
  });

  it('brief 里的占位符与 fields 对得上：都声明、都引用、label 不重复', () => {
    const ok = (patch: Partial<TemplateManifest>) => templateManifestSchema.safeParse({ ...base, ...patch }).success;
    expect(ok({ brief: '给 {{主题}} 做一条讲解，受众是 {{受众}}，再讲一遍 {{主题}}。' })).toBe(true);
    expect(ok({ brief: '给 {{主题}} 做一条讲解。' }), '受众没被引用').toBe(false);
    expect(ok({ brief: '给 {{主题}} 做一条讲解，受众是 {{受众}}，时长 {{时长}}。' }), '时长没声明').toBe(false);
    expect(ok({ brief: '给 {{主题}} 做一条讲解，受众是 {{受众}}，{{ 不成对。' })).toBe(false);
    expect(ok({ brief: '做一条讲解。', fields: [] })).toBe(true);
    expect(ok({ brief: '做一条讲解。' }), '声明了却没用').toBe(false);
    expect(ok({ brief: 'x'.repeat(TEMPLATE_LIMITS.brief + 1) })).toBe(false);
    expect(ok({ fields: [...base.fields!, { label: '主题' }] })).toBe(false);
    for (const label of ['a{b', 'a}b', 'a\nb', '', ' 主题', 'x'.repeat(TEMPLATE_LIMITS.fieldLabel + 1)])
      expect(ok({ brief: `{{${label}}}`, fields: [{ label }] }), JSON.stringify(label)).toBe(false);
    expect(ok({ fields: [{ label: '主题', example: '光合作用', note: '多余' } as never, { label: '受众' }] })).toBe(false);
    expect(ok({ fields: [{ label: '主题', hint: 'x'.repeat(TEMPLATE_LIMITS.fieldHint + 1) }, { label: '受众' }] })).toBe(false);
    const many = Array.from({ length: TEMPLATE_LIMITS.fields + 1 }, (_, i) => ({ label: `项${i}` }));
    expect(ok({ brief: many.map((f) => `{{${f.label}}}`).join(''), fields: many })).toBe(false);
  });

  it('skills：kebab-case、不重复、最多 4 项', () => {
    const ok = (skills: unknown) => templateManifestSchema.safeParse({ ...base, skills }).success;
    expect(ok([])).toBe(true);
    expect(ok(['video-production', 'video-production'])).toBe(false);
    expect(ok(['Narration'])).toBe(false);
    expect(ok(['a', 'b', 'c', 'd', 'e'])).toBe(false);
  });

  it('时长 5–600 秒、步长 5；beats 3–5 条', () => {
    for (const durationSeconds of [0, 3, 7, 605, 12.5])
      expect(templateManifestSchema.safeParse({ ...base, durationSeconds }).success).toBe(false);
    for (const durationSeconds of [5, 600, 185]) expect(templateManifestSchema.safeParse({ ...base, durationSeconds }).success).toBe(true);
    expect(templateManifestSchema.safeParse({ ...base, preview: { beats: ['一', '二'] } }).success).toBe(false);
    expect(templateManifestSchema.safeParse({ ...base, preview: { beats: ['1', '2', '3', '4', '5', '6'] } }).success).toBe(false);
  });

  it('未知字段被拒绝，不认识的 schema 单独报出', () => {
    expect(templateManifestSchema.safeParse({ ...base, mode: 'quality' }).success).toBe(false);
    expect(templateManifestSchema.safeParse({ ...base, cover: { ...base.cover, color: 'red' } }).success).toBe(false);
    expect(parseTemplateManifest({ ...base, schema: 2 })).toMatchObject({ ok: false, reason: 'unsupported-schema' });
    expect(parseTemplateManifest(null)).toMatchObject({ ok: false, reason: 'unsupported-schema' });
    expect(parseTemplateManifest(base, 'other-name')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('id、版本、语言与许可的格式', () => {
    for (const id of ['Promo', 'promo_ad', '-promo', 'promo--ad', '1promo'])
      expect(templateManifestSchema.safeParse({ ...base, id }).success, id).toBe(false);
    expect(templateManifestSchema.safeParse({ ...base, version: '1.0' }).success).toBe(false);
    expect(templateManifestSchema.safeParse({ ...base, language: 'Chinese' }).success).toBe(false);
    expect(templateManifestSchema.safeParse({ ...base, license: 'MIT OR Apache-2.0' }).success).toBe(true);
  });

  it('路径只能是目录内的相对路径；封面、预览与素材各有位置', () => {
    for (const p of ['', '/etc/passwd', 'C:/x.png', '~/x.png', '../x.png', 'assets/../x.png', 'assets//x.png', 'assets\\x.png', './x.png'])
      expect(templatePathProblem(p), p).not.toBeNull();
    expect(templatePathProblem('assets/logo.svg')).toBeNull();

    const cover = (file: string) => templateManifestSchema.safeParse({ ...base, cover: { file } }).success;
    expect(cover('cover.png')).toBe(true);
    expect(cover('assets/cover.png')).toBe(false);
    expect(cover('poster.png')).toBe(false);
    expect(cover('cover.mp4')).toBe(false);
    expect(templateManifestSchema.safeParse({ ...base, cover: { kicker: '01' } }).success).toBe(false);
    expect(templateManifestSchema.safeParse({ ...base, preview: { file: 'preview.mp4' } }).success).toBe(true);
    expect(templateManifestSchema.safeParse({ ...base, preview: { file: 'preview.gif' } }).success).toBe(false);
    expect(templateManifestSchema.safeParse({ ...base, preview: {} }).success).toBe(false);
    const { preview: _p, ...noPreview } = base;
    expect(templateManifestSchema.safeParse(noPreview).success).toBe(false);

    const assets = (list: unknown) => templateManifestSchema.safeParse({ ...base, assets: list }).success;
    expect(assets([{ path: 'assets/bgm.mp3', type: 'audio', note: '背景音乐' }])).toBe(true);
    expect(assets([{ path: 'bgm.mp3', type: 'audio', note: '背景音乐' }])).toBe(false);
    expect(assets([{ path: 'assets/bgm.mp3', type: 'image', note: '背景音乐' }])).toBe(false);
    expect(assets([{ path: 'assets/bgm.mp3', type: 'audio', note: '' }])).toBe(false);
    const dup = { path: 'assets/a.svg', type: 'svg', note: '图标' };
    expect(assets([dup, dup])).toBe(false);
  });
});

describe('待填项', () => {
  const fields = [{ label: '产品', example: '线上瑜伽课' }, { label: '受众' }];

  it('取出占位符，换成示例或「[label]」', () => {
    const text = '给 {{产品}} 做推广，受众是 {{受众}}，{{产品}} 要出现两次；{单个花括号}不算。';
    expect(templateSlots(text)).toEqual(['产品', '受众', '产品']);
    expect(templateExampleText(text, fields)).toBe('给 线上瑜伽课 做推广，受众是 受众，线上瑜伽课 要出现两次；{单个花括号}不算。');
    expect(templateUnfilledText(text)).toBe('给 [产品] 做推广，受众是 [受众]，[产品] 要出现两次；{单个花括号}不算。');
  });

  it('对照声明找问题；scene 的正文不得有占位符，example 的正文与 fields 对得上', () => {
    expect(templateSlotProblems('给 {{产品}}，受众 {{受众}}。', fields)).toEqual([]);
    expect(templateSlotProblems('给 {{产品}}，时长 {{时长}}。', fields)).toHaveLength(2);
    expect(templateSlotProblems('给 {{产品}}，受众 {{受众}}，{{坏的', fields)).toHaveLength(1);
    expect(templatePromptSlotProblems({ kind: 'scene', fields }, '你要做一条推广短片。')).toEqual([]);
    expect(templatePromptSlotProblems({ kind: 'scene', fields }, '你要给 {{产品}} 做推广。')).toHaveLength(1);
    expect(templatePromptSlotProblems({ kind: 'example', fields }, '给 {{产品}} 做推广，受众是 {{受众}}。')).toEqual([]);
    expect(templatePromptSlotProblems({ kind: 'example' }, '做一条推广。')).toEqual([]);
    expect(templatePromptSlotProblems({ kind: 'example', fields }, '给 {{产品}} 做推广。')).toHaveLength(1);
  });
});

describe('验证记录', () => {
  const verification: TemplateVerification = {
    date: '2026-10-04',
    version: '1.0.0',
    engine: 'codex',
    input: '按提示词原样。',
    materials: [{ title: '城市夜景', url: 'https://example.org/photo/1', license: 'CC0-1.0', note: '第二幕背景' }],
    capabilities: ['synthesizeSpeech', 'generateMusic'],
    outcome: 'partial',
    output: { ratio: '16:9', durationSeconds: 15.2 },
    notes: '没有旁白。',
  };
  const ok = (v: unknown) => templateManifestSchema.safeParse({ ...base, verification: v }).success;

  it('合规的记录；封面图、预览视频与占位字段可以并存', () => {
    expect(ok(verification)).toBe(true);
    expect(ok({ ...verification, materials: [], capabilities: [] })).toBe(true);
    const full = {
      ...base,
      cover: { file: 'cover.jpg', tone: 'blue', figure: 'ring', kicker: 'REEL' },
      preview: { file: 'preview.mp4', beats: ['一', '二', '三'] },
    };
    expect(templateManifestSchema.safeParse({ ...full, verification }).success).toBe(true);
  });

  it('日期、版本、引擎、结论与能力的取值', () => {
    for (const date of ['2026-13-01', '2026-02-30', '2026/10/04', '20261004']) expect(ok({ ...verification, date }), date).toBe(false);
    expect(ok({ ...verification, version: '1.0' })).toBe(false);
    expect(ok({ ...verification, engine: 'Codex 0.159' })).toBe(false);
    expect(ok({ ...verification, outcome: 'ok' })).toBe(false);
    expect(ok({ ...verification, capabilities: ['speech'] })).toBe(false);
    expect(ok({ ...verification, capabilities: ['generateMusic', 'generateMusic'] })).toBe(false);
  });

  it('有成片时必须给实测的画幅与时长；fail 可以没有', () => {
    const { output: _o, ...noOutput } = verification;
    expect(ok(noOutput)).toBe(false);
    expect(ok({ ...noOutput, outcome: 'fail' })).toBe(true);
    expect(ok({ ...verification, output: { ratio: '16x9', durationSeconds: 15 } })).toBe(false);
    expect(ok({ ...verification, output: { ratio: '16:9', durationSeconds: 0 } })).toBe(false);
  });

  it('素材要有 https 地址与许可；未知字段被拒绝', () => {
    const material = verification.materials[0]!;
    expect(ok({ ...verification, materials: [{ ...material, url: 'http://example.org/x' }] })).toBe(false);
    expect(ok({ ...verification, materials: [{ ...material, license: '' }] })).toBe(false);
    expect(ok({ ...verification, materials: [{ ...material, author: '某人' }] })).toBe(false);
    expect(ok({ ...verification, model: 'x' })).toBe(false);
    expect(ok({ ...verification, notes: '' })).toBe(false);
  });
});

describe('templates.* 与发送时挂的模板', () => {
  it('发送时的模板引用：id 为 kebab-case，素材是目录内的相对路径，没有别的字段', () => {
    expect(templateSendRefSchema.safeParse({ id: 'launch-film', version: '1.0.0', assets: ['assets/logo.svg'] }).success).toBe(true);
    expect(templateSendRefSchema.safeParse({ id: 'Launch' }).success).toBe(false);
    expect(templateSendRefSchema.safeParse({ id: 'launch-film', assets: ['../x.svg'] }).success).toBe(false);
    expect(templateSendRefSchema.safeParse({ id: 'launch-film', prompt: '自己写的' }).success).toBe(false);
    const send = methodParamSchemas['conversations.send'];
    expect(send.safeParse({ conversationId: 'c', text: 'hi', commandId: 'k', template: { id: 'launch-film' } }).success).toBe(true);
  });

  it('openHandle 只收模板内的相对路径', () => {
    const open = methodParamSchemas['templates.openHandle'];
    expect(open.safeParse({ id: 'launch-film', path: 'cover.png' }).success).toBe(true);
    for (const p of ['/etc/passwd', '../x.png', 'assets//x.svg'])
      expect(open.safeParse({ id: 'launch-film', path: p }).success, p).toBe(false);
    expect(methodParamSchemas['templates.list'].safeParse({ extra: 1 }).success).toBe(false);
  });
});

/** 目录内的全部文件（相对路径，正斜杠），点开头的隐藏文件不算。 */
function listFiles(dir: string, prefix = ''): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel];
    });
}

describe('仓库内置模板 templates/', () => {
  const dirs = fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it('有模板目录', () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it.each(dirs)('%s：清单合法、id 等于目录名、提示词非空、引用的文件都在', (dir) => {
    const root = path.join(TEMPLATES_DIR, dir);
    const result = parseTemplateManifest(JSON.parse(fs.readFileSync(path.join(root, TEMPLATE_MANIFEST_FILE), 'utf8')), dir);
    if (!result.ok) throw new Error(`${dir}: ${result.issues.join('; ')}`);
    const manifest = result.manifest;

    const prompt = fs.readFileSync(path.join(root, TEMPLATE_PROMPT_FILE), 'utf8');
    expect(prompt.trim().length).toBeGreaterThan(0);
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(TEMPLATE_LIMITS.promptBytes);
    expect(prompt, '提示词不得含机器路径').not.toMatch(/\/Users\/|\/home\/|[A-Za-z]:\\/);
    expect(templatePromptSlotProblems(manifest, prompt), `${dir} 的 prompt.md 与 fields 对不上`).toEqual([]);
    expect(manifest.skills ?? [], `${dir} 应建议先读 video-production`).toContain('video-production');

    const declared = [manifest.cover.file, manifest.preview.file, ...(manifest.assets ?? []).map((a) => a.path)].filter(
      (p): p is string => p != null,
    );
    for (const p of declared) expect(fs.existsSync(path.join(root, p)), `${dir}/${p}`).toBe(true);
    if (manifest.cover.file)
      expect(fs.statSync(path.join(root, manifest.cover.file)).size, `${dir} 的封面超过上限`).toBeLessThanOrEqual(
        TEMPLATE_FILE_MAX_BYTES.cover,
      );
    if (manifest.preview.file)
      expect(fs.statSync(path.join(root, manifest.preview.file)).size, `${dir} 的预览超过上限`).toBeLessThanOrEqual(
        TEMPLATE_FILE_MAX_BYTES.preview,
      );

    const allowed = new Set([TEMPLATE_MANIFEST_FILE, TEMPLATE_PROMPT_FILE, ...declared]);
    const stray = listFiles(root).filter((p) => !allowed.has(p));
    expect(stray, `${dir} 里有清单没登记的文件`).toEqual([]);
  });

  it('id 不重复', () => {
    const ids = dirs.map((dir) => JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, dir, TEMPLATE_MANIFEST_FILE), 'utf8')).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
