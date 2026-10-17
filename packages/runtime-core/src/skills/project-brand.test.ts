import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROJECT_BRAND_MAX_BYTES, RpcError, type Project } from '@baocut/protocol';
import { SkillPrefsStore } from '@baocut/runtime-storage';
import { brandBodyFromSkill, ProjectBrands } from './project-brand.ts';
import { SkillCatalog } from './skill-catalog.ts';
import { writeSkill } from './testing/skill-fixtures.ts';

/** 架构设计 §3.8「项目品牌」：项目根目录的 BRAND.md 与 brand/。 */

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('should have been rejected');
}

describe('project brand', () => {
  let dir: string;
  let builtin: string;
  let projects: Project[];
  let brands: ProjectBrands;

  const project = (id: string, extra: Partial<Project> = {}): Project => ({
    id,
    name: `Project ${id}`,
    path: path.join(dir, id),
    createdAt: '2026-10-01T00:00:00Z',
    lastActiveAt: '2026-10-01T00:00:00Z',
    pinned: false,
    archived: false,
    ...extra,
  });

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-brand-')));
    builtin = path.join(dir, 'builtin');
    await fs.mkdir(builtin);
    projects = [project('a'), project('b'), project('old', { archived: true })];
    for (const p of projects) await fs.mkdir(p.path);
    const prefs = new SkillPrefsStore(path.join(dir, 'prefs.json'));
    await prefs.load();
    const skills = new SkillCatalog({ builtinDir: builtin, userDir: path.join(dir, 'skills'), prefs });
    brands = new ProjectBrands({ projects: () => projects, skills });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('lists only unarchived projects that have BRAND.md, with the one-line summary', async () => {
    await fs.writeFile(path.join(dir, 'a', 'BRAND.md'), '# A brand\n\nWarm and short.\nSecond line.\n\nMore.');
    await fs.mkdir(path.join(dir, 'a', 'brand'));
    await fs.writeFile(path.join(dir, 'a', 'brand', 'logo.svg'), '<svg/>');
    await fs.writeFile(path.join(dir, 'old', 'BRAND.md'), 'archived');
    const { brands: list } = await brands.list();
    expect(list).toEqual([
      expect.objectContaining({
        projectId: 'a',
        path: path.join(dir, 'a', 'BRAND.md'),
        summary: 'Warm and short. Second line.',
        fileCount: 2,
      }),
    ]);
    const detail = await brands.get('a');
    expect(detail.files.map((f) => [f.path, f.text])).toEqual([
      ['BRAND.md', true],
      ['brand/logo.svg', true],
    ]);
    expect(await brands.get('b')).toEqual({ projectId: 'b', brand: null, content: null, files: [] });
    expect((await brands.readFile('a', 'brand/logo.svg')).content).toBe('<svg/>');
    expect((await brands.locate('a', 'brand/logo.svg')).file).toBe(path.join(dir, 'a', 'brand', 'logo.svg'));
    expect((await rejection(brands.readFile('a', '../b/x'))).details).toMatchObject({ code: 'BRAND_NOT_FOUND' });
    expect((await rejection(brands.get('nope'))).details).toMatchObject({ code: 'BRAND_NOT_FOUND' });
  });

  it('write creates and edits BRAND.md and brand/ only; BRAND.md cannot be removed', async () => {
    const missing = await rejection(brands.write({ projectId: 'b', changes: [{ path: 'brand/x.md', text: 'x' }] }));
    expect(missing.details).toMatchObject({ code: 'BRAND_NOT_FOUND' });
    const { brand } = await brands.write({ projectId: 'b', changes: [{ path: 'BRAND.md', text: '---\ndescription: B rules\n---\n# B' }] });
    expect(brand).toMatchObject({ projectId: 'b', summary: 'B rules', fileCount: 1 });
    await brands.write({ projectId: 'b', changes: [{ path: 'brand/notes.md', text: 'n' }] });
    expect((await brands.get('b')).files.map((f) => f.path)).toEqual(['BRAND.md', 'brand/notes.md']);
    for (const bad of ['README.md', 'brand/', '.bcut/project.json']) {
      expect((await rejection(brands.write({ projectId: 'b', changes: [{ path: bad, text: 'x' }] }))).details).toMatchObject({
        code: 'SKILL_INVALID',
      });
    }
    expect((await rejection(brands.write({ projectId: 'b', changes: [{ path: 'BRAND.md', remove: true }] }))).details).toMatchObject({
      code: 'SKILL_INVALID',
    });
    await brands.write({ projectId: 'b', changes: [{ path: 'brand/notes.md', remove: true }] });
    await expect(fs.stat(path.join(dir, 'b', 'brand'))).rejects.toThrow();
  });

  it('a repeated commandId runs the write once; a failed one can be retried', async () => {
    const first = await brands.write({ projectId: 'b', changes: [{ path: 'BRAND.md', text: '# One' }], commandId: 'c1' });
    await fs.writeFile(path.join(dir, 'b', 'BRAND.md'), '# Edited elsewhere');
    expect(await brands.write({ projectId: 'b', changes: [{ path: 'BRAND.md', text: '# One' }], commandId: 'c1' })).toEqual(first);
    expect(await fs.readFile(path.join(dir, 'b', 'BRAND.md'), 'utf8')).toBe('# Edited elsewhere');
    await rejection(brands.write({ projectId: 'a', changes: [{ path: 'brand/x.md', text: 'x' }], commandId: 'c2' }));
    await fs.writeFile(path.join(dir, 'a', 'BRAND.md'), '# A');
    await brands.write({ projectId: 'a', changes: [{ path: 'brand/x.md', text: 'x' }], commandId: 'c2' });
    expect((await brands.get('a')).files.map((f) => f.path)).toEqual(['BRAND.md', 'brand/x.md']);
  });

  it('refuses to write through a brand/ that is a symlink', async () => {
    await fs.writeFile(path.join(dir, 'a', 'BRAND.md'), '# A');
    await fs.mkdir(path.join(dir, 'outside'));
    await fs.symlink(path.join(dir, 'outside'), path.join(dir, 'a', 'brand'));
    const refused = await rejection(brands.write({ projectId: 'a', changes: [{ path: 'brand/x.md', text: 'x' }] }));
    expect(refused.details).toMatchObject({ code: 'SKILL_INVALID', path: 'brand' });
    expect(await fs.readdir(path.join(dir, 'outside'))).toEqual([]);
  });

  it('createFromSkill strips front matter, moves assets and references into brand/ and leaves scripts out', async () => {
    await writeSkill(builtin, 'acme-brand', {
      extra: '# Acme\n\nLogo: assets/logo.svg. See references/tone.md and ./assets/x.png.',
      files: { 'assets/logo.svg': '<svg/>', 'references/tone.md': 'tone', 'notes.txt': 'n', 'scripts/build.py': 'print()' },
    });
    const { brand } = await brands.createFromSkill({ projectId: 'a', skillId: 'acme-brand' });
    expect(brand.fileCount).toBe(4);
    const content = await fs.readFile(path.join(dir, 'a', 'BRAND.md'), 'utf8');
    expect(content).toBe('# Acme\n\nLogo: brand/logo.svg. See brand/tone.md and ./assets/x.png.');
    expect((await brands.get('a')).files.map((f) => f.path)).toEqual(['BRAND.md', 'brand/logo.svg', 'brand/notes.txt', 'brand/tone.md']);
    const again = await rejection(brands.createFromSkill({ projectId: 'a', skillId: 'acme-brand' }));
    expect(again).toMatchObject({ code: 'conflict', details: { code: 'BRAND_EXISTS' } });
  });

  it('brandBodyFromSkill rewrites only bare assets/ and references/ prefixes', () => {
    expect(brandBodyFromSkill('---\nname: x\n---\n\nassets/a.png\n(references/b.md) my-assets/c x/assets/d')).toBe(
      'brand/a.png\n(brand/b.md) my-assets/c x/assets/d',
    );
  });

  it('sendBrand: applied with the brief, skipped without it, nothing outside a project or without BRAND.md', async () => {
    await fs.writeFile(path.join(dir, 'a', 'BRAND.md'), '# A\n\nUse teal.');
    await fs.mkdir(path.join(dir, 'a', 'brand'));
    await fs.writeFile(path.join(dir, 'a', 'brand', 'logo.svg'), '<svg/>');
    const brandPath = path.join(dir, 'a', 'BRAND.md');
    const applied = await brands.sendBrand('a', false);
    expect(applied?.ref).toEqual({ state: 'applied', path: brandPath });
    expect(applied?.instructions).toMatch(/^<baocut-project-brand path=".*BRAND\.md">/);
    expect(applied?.instructions).toContain('what the user says in this message > BRAND.md > any brand skill');
    expect(applied?.instructions).toContain('Use teal.');
    expect(applied?.instructions).toContain(`- ${path.join(dir, 'a', 'brand', 'logo.svg')}`);
    expect(await brands.sendBrand('a', true)).toEqual({ ref: { state: 'skipped', path: brandPath }, instructions: null });
    expect(await brands.sendBrand('b', false)).toBeNull();
    expect(await brands.sendBrand(null, false)).toBeNull();
  });

  it('sendBrand cuts BRAND.md at the byte cap on a character boundary and notes it; unreadable text gives a notice', async () => {
    await fs.writeFile(path.join(dir, 'a', 'BRAND.md'), `${'a'.repeat(PROJECT_BRAND_MAX_BYTES - 1)}品牌`);
    const cut = await brands.sendBrand('a', false);
    expect(cut?.instructions).toContain(`longer than ${PROJECT_BRAND_MAX_BYTES} bytes`);
    expect(cut?.instructions).not.toContain('品');
    await fs.writeFile(path.join(dir, 'b', 'BRAND.md'), Buffer.from([0xff, 0xfe, 0x00, 0x41]));
    const unreadable = await brands.sendBrand('b', false);
    expect(unreadable).toMatchObject({ ref: null, instructions: null, notice: { key: expect.any(String) } });
  });
});
