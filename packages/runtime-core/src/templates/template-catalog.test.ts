import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, TEMPLATE_FILE_MAX_BYTES, type TemplateManifest } from '@baocut/protocol';
import { TemplateCatalog, resolveBuiltinTemplatesDir, scanTemplateDir } from './template-catalog.ts';

/** 仓库根的 `templates/`：从本文件往上四级（packages/runtime-core/src/templates）。 */
const REPO_TEMPLATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../templates');
/** 仓库根的 `skills/`：内置模板 `skills` 里写的 craft 都要在这里。 */
const REPO_SKILLS = path.resolve(REPO_TEMPLATES, '../skills');

const manifest = (id: string, extra: Partial<TemplateManifest> = {}): TemplateManifest => ({
  schema: 1,
  id,
  version: '1.0.0',
  kind: 'scene',
  title: '示例模板',
  summary: '一句话。',
  description: '一小段。',
  language: 'zh-CN',
  category: 'explainer',
  ratio: '16:9',
  durationSeconds: 60,
  brief: '给{{主题}}做一条讲解。',
  fields: [{ label: '主题', example: '光合作用' }],
  author: 'BaoCut',
  source: 'community',
  license: 'Apache-2.0',
  tags: [],
  cover: { tone: 'blue', figure: 'steps' },
  preview: { beats: ['一', '二', '三'] },
  ...extra,
});

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-templates-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** 在 `dir` 下写一个模板：清单（可以是任意值）、提示词与别的文件。 */
async function writeTemplate(dir: string, name: string, value: unknown, files: Record<string, string | Buffer> = {}) {
  const at = path.join(dir, name);
  await fs.mkdir(at, { recursive: true });
  await fs.writeFile(path.join(at, 'template.json'), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const all = { 'prompt.md': '你要做一条视频。\n', ...files };
  for (const [rel, content] of Object.entries(all)) {
    await fs.mkdir(path.dirname(path.join(at, rel)), { recursive: true });
    await fs.writeFile(path.join(at, rel), content);
  }
  return at;
}

describe('模板目录的加载', () => {
  it('合规的模板连同封面与素材一起加载；隐藏文件与不是目录的条目忽略', async () => {
    await writeTemplate(
      root,
      'with-files',
      manifest('with-files', {
        cover: { file: 'cover.png', tone: 'blue' },
        assets: [{ path: 'assets/logos/x.svg', type: 'svg', note: '片尾标志' }],
      }),
      { 'cover.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'assets/logos/x.svg': '<svg/>', '.DS_Store': 'x' },
    );
    await fs.writeFile(path.join(root, 'README.md'), '说明');
    await fs.mkdir(path.join(root, '.hidden'));

    const scan = await scanTemplateDir(root, 'user');
    expect(scan.diagnostics).toEqual([]);
    expect(scan.templates).toHaveLength(1);
    expect(scan.templates[0]).toMatchObject({ origin: 'user', dir: path.join(root, 'with-files'), prompt: '你要做一条视频。\n' });
  });

  it('坏清单、id 与目录名不符、不认识的 schema：跳过并记诊断，其余照常', async () => {
    await writeTemplate(root, 'good', manifest('good'));
    await writeTemplate(root, 'broken-json', '{ not json');
    await writeTemplate(root, 'mismatch', manifest('other-id'));
    await writeTemplate(root, 'future', { ...manifest('future'), schema: 2 });
    await writeTemplate(root, 'extra-field', { ...manifest('extra-field'), quality: 'high' });

    const scan = await scanTemplateDir(root, 'builtin');
    expect(scan.templates.map((t) => t.manifest.id)).toEqual(['good']);
    const byDir = Object.fromEntries(scan.diagnostics.map((d) => [d.dir, d]));
    expect(byDir['broken-json']).toMatchObject({ code: 'invalid', origin: 'builtin', path: path.join(root, 'broken-json') });
    expect(byDir['mismatch']).toMatchObject({ code: 'invalid' });
    expect(byDir['mismatch']!.issues.join()).toContain('目录名');
    expect(byDir['future']).toMatchObject({ code: 'unsupported-schema' });
    expect(byDir['extra-field']).toMatchObject({ code: 'invalid' });
  });

  it('prompt.md 缺失、为空、超过上限或不是 UTF-8 都不合规', async () => {
    await writeTemplate(root, 'empty-prompt', manifest('empty-prompt'), { 'prompt.md': '  \n' });
    await writeTemplate(root, 'big-prompt', manifest('big-prompt'), { 'prompt.md': 'x'.repeat(16 * 1024 + 1) });
    await writeTemplate(root, 'bad-utf8', manifest('bad-utf8'), { 'prompt.md': Buffer.from([0xff, 0xfe, 0x41]) });
    const missing = await writeTemplate(root, 'no-prompt', manifest('no-prompt'));
    await fs.rm(path.join(missing, 'prompt.md'));

    const scan = await scanTemplateDir(root, 'user');
    expect(scan.templates).toEqual([]);
    expect(Object.fromEntries(scan.diagnostics.map((d) => [d.dir, d.issues.join()]))).toEqual({
      'empty-prompt': 'prompt.md 是空的',
      'big-prompt': 'prompt.md 超过 16384 字节',
      'bad-utf8': 'prompt.md 不是合法的 UTF-8',
      'no-prompt': '缺少 prompt.md',
    });
  });

  it('占位符：scene 的 prompt.md 不得有 {{，example 的 prompt.md 与 fields 对得上', async () => {
    const example = (id: string, fields: TemplateManifest['fields']) => {
      const { ratio: _r, durationSeconds: _d, brief: _b, fields: _f, ...rest } = manifest(id);
      return { ...rest, kind: 'example' as const, ...(fields ? { fields } : {}) };
    };
    await writeTemplate(root, 'scene-slot', manifest('scene-slot'), { 'prompt.md': '你要给{{主题}}做一条讲解。\n' });
    await writeTemplate(root, 'example-ok', example('example-ok', [{ label: '主题' }]), { 'prompt.md': '给{{主题}}做一条讲解。\n' });
    await writeTemplate(root, 'example-undeclared', example('example-undeclared', undefined), { 'prompt.md': '给{{主题}}做一条讲解。\n' });
    await writeTemplate(root, 'example-unused', example('example-unused', [{ label: '主题' }, { label: '受众' }]), {
      'prompt.md': '给{{主题}}做一条讲解。\n',
    });

    const scan = await scanTemplateDir(root, 'user');
    expect(scan.templates.map((t) => t.manifest.id)).toEqual(['example-ok']);
    expect(Object.fromEntries(scan.diagnostics.map((d) => [d.dir, d.issues.join()]))).toEqual({
      'scene-slot': '场景模板的 prompt.md 不能含 {{ 占位符，待填项写在 brief 里',
      'example-undeclared': '{{主题}} 没有在 fields 里声明',
      'example-unused': '待填项「受众」没有被引用（{{受众}}）',
    });
  });

  it('登记的文件要在，目录里的文件都要登记', async () => {
    await writeTemplate(root, 'missing-cover', manifest('missing-cover', { cover: { file: 'cover.png', tone: 'blue' } }));
    await writeTemplate(root, 'stray-file', manifest('stray-file'), { 'notes.txt': '草稿', 'assets/x.svg': '<svg/>' });

    const scan = await scanTemplateDir(root, 'user');
    expect(scan.templates).toEqual([]);
    const issues = Object.fromEntries(scan.diagnostics.map((d) => [d.dir, d.issues]));
    expect(issues['missing-cover']).toEqual(['登记的文件不存在：cover.png']);
    expect(issues['stray-file']).toEqual(['目录里有没登记的文件：assets/x.svg', '目录里有没登记的文件：notes.txt']);
  });

  it('封面与预览超过体积上限时不合规', async () => {
    const cover = { file: 'cover.jpg', tone: 'blue' as const };
    const big = manifest('too-big', { cover, preview: { file: 'preview.mp4' } });
    await writeTemplate(root, 'too-big', big, {
      'cover.jpg': Buffer.alloc(TEMPLATE_FILE_MAX_BYTES.cover + 1),
      'preview.mp4': Buffer.alloc(TEMPLATE_FILE_MAX_BYTES.preview + 1),
    });
    const limit = manifest('at-limit', { cover, preview: { file: 'preview.mp4' } });
    await writeTemplate(root, 'at-limit', limit, {
      'cover.jpg': Buffer.alloc(TEMPLATE_FILE_MAX_BYTES.cover),
      'preview.mp4': Buffer.alloc(TEMPLATE_FILE_MAX_BYTES.preview),
    });

    const scan = await scanTemplateDir(root, 'user');
    expect(scan.templates.map((t) => t.manifest.id)).toEqual(['at-limit']);
    expect(scan.diagnostics.map((d) => [d.dir, d.issues.length])).toEqual([['too-big', 2]]);
    expect(scan.diagnostics[0]!.issues[0]).toMatch(/^cover\.jpg 超过 153600 字节/);
  });

  it('清单里的路径越出模板目录时不合规', async () => {
    await writeTemplate(root, 'escape', manifest('escape', { assets: [{ path: 'assets/../../secret.svg', type: 'svg', note: '标志' }] }));
    const scan = await scanTemplateDir(root, 'user');
    expect(scan.templates).toEqual([]);
    expect(scan.diagnostics[0]).toMatchObject({ code: 'invalid', dir: 'escape' });
  });

  it('符号链接不跟随：模板里的链接让模板不合规，指出去的模板目录不加载', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-outside-'));
    try {
      await fs.writeFile(path.join(outside, 'secret.svg'), '<svg/>');
      const linked = await writeTemplate(
        root,
        'linked-asset',
        manifest('linked-asset', { assets: [{ path: 'assets/secret.svg', type: 'svg', note: '标志' }] }),
      );
      await fs.mkdir(path.join(linked, 'assets'), { recursive: true });
      await fs.symlink(path.join(outside, 'secret.svg'), path.join(linked, 'assets', 'secret.svg'));
      await writeTemplate(outside, 'elsewhere', manifest('elsewhere'));
      await fs.symlink(path.join(outside, 'elsewhere'), path.join(root, 'elsewhere'));

      const scan = await scanTemplateDir(root, 'user');
      expect(scan.templates).toEqual([]);
      const byDir = Object.fromEntries(scan.diagnostics.map((d) => [d.dir, d]));
      expect(byDir['linked-asset']!.issues).toEqual(['不得含符号链接：assets/secret.svg']);
      expect(byDir['elsewhere']!.message).toContain('符号链接');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('相对路径的目录照常加载，诊断给绝对路径', async () => {
    await writeTemplate(root, 'good', manifest('good'));
    await writeTemplate(root, 'bad', manifest('other'));
    const scan = await scanTemplateDir(path.relative(process.cwd(), root), 'builtin');
    expect(scan.templates.map((t) => [t.manifest.id, t.dir])).toEqual([['good', path.join(root, 'good')]]);
    expect(scan.diagnostics.map((d) => d.path)).toEqual([path.join(root, 'bad')]);
  });

  it('目录不存在时为空', async () => {
    expect(await scanTemplateDir(path.join(root, 'nope'), 'user')).toEqual({ templates: [], diagnostics: [] });
  });
});

describe('两个来源合在一起', () => {
  let builtin: string;
  let user: string;

  beforeEach(async () => {
    builtin = path.join(root, 'builtin');
    user = path.join(root, 'user');
    await writeTemplate(builtin, 'shared-id', manifest('shared-id', { title: '内置的' }));
    await writeTemplate(user, 'shared-id', manifest('shared-id', { title: '用户的' }));
    await writeTemplate(user, 'my-own', manifest('my-own'));
  });

  it('同 id 时内置的优先，用户的那一份记 builtin-conflict', async () => {
    const catalog = new TemplateCatalog({ builtinDir: builtin, userDir: user });
    const { templates, diagnostics } = await catalog.list();
    expect(templates.map((t) => [t.manifest.id, t.origin, t.manifest.title])).toEqual([
      ['shared-id', 'builtin', '内置的'],
      ['my-own', 'user', '示例模板'],
    ]);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'builtin-conflict', origin: 'user', dir: 'shared-id', path: path.join(user, 'shared-id') }),
    ]);
  });

  it('不缓存：用户放进新模板、删掉模板之后再列一次就变了', async () => {
    const catalog = new TemplateCatalog({ builtinDir: builtin, userDir: user });
    expect((await catalog.list()).templates).toHaveLength(2);
    await writeTemplate(user, 'later', manifest('later'));
    expect((await catalog.list()).templates.map((t) => t.manifest.id)).toContain('later');
    await fs.rm(path.join(user, 'my-own'), { recursive: true });
    await expect(catalog.get('my-own')).rejects.toMatchObject({ code: 'not-found', details: { code: 'TEMPLATE_NOT_FOUND' } });
  });

  it('get 给清单与正文；locate 只认登记的随附文件', async () => {
    await writeTemplate(
      user,
      'with-cover',
      manifest('with-cover', { cover: { file: 'cover.png', tone: 'blue' }, assets: [{ path: 'assets/x.svg', type: 'svg', note: '标志' }] }),
      { 'cover.png': 'png', 'assets/x.svg': '<svg/>' },
    );
    const catalog = new TemplateCatalog({ builtinDir: null, userDir: user });
    const detail = await catalog.get('with-cover');
    expect(detail.prompt).toBe('你要做一条视频。\n');
    expect(detail.template.files).toEqual({ cover: true, preview: false, assets: 1 });
    expect(await catalog.locate('with-cover', 'assets/x.svg')).toEqual({ root: path.join(user, 'with-cover'), file: 'assets/x.svg' });
    for (const file of ['prompt.md', 'template.json', 'preview.mp4']) {
      const error = await catalog.locate('with-cover', file).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RpcError);
      expect(error).toMatchObject({ code: 'not-found', details: { code: 'TEMPLATE_FILE_NOT_FOUND' } });
    }
  });
});

describe('内置模板', () => {
  it('仓库的 templates/ 全部加载成功，没有诊断', async () => {
    const catalog = new TemplateCatalog({ builtinDir: REPO_TEMPLATES, userDir: path.join(root, 'none') });
    const { templates, diagnostics } = await catalog.list();
    expect(diagnostics).toEqual([]);
    const dirs = (await fs.readdir(REPO_TEMPLATES, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    expect(templates).toHaveLength(dirs.length);
    expect(templates.length).toBeGreaterThanOrEqual(24);
    expect(templates.every((t) => t.origin === 'builtin' && t.manifest.source === 'official')).toBe(true);
    expect(new Set(templates.map((t) => t.manifest.kind))).toEqual(new Set(['scene', 'example']));
  });

  it('内置模板建议先读的 skills 都在仓库根的 skills/ 里', async () => {
    const { templates } = await new TemplateCatalog({ builtinDir: REPO_TEMPLATES, userDir: path.join(root, 'none') }).list();
    const missing = templates.flatMap((t) =>
      (t.manifest.skills ?? []).filter((id) => !existsSync(path.join(REPO_SKILLS, id, 'SKILL.md'))).map((id) => `${t.manifest.id} → ${id}`),
    );
    expect(missing).toEqual([]);
  });

  it('目录解析：环境变量优先，开发时找到仓库根的 templates/', () => {
    expect(resolveBuiltinTemplatesDir({ BAOCUT_TEMPLATES_DIR: '/opt/x/templates' })).toBe('/opt/x/templates');
    expect(resolveBuiltinTemplatesDir({})).toBe(REPO_TEMPLATES);
  });
});
