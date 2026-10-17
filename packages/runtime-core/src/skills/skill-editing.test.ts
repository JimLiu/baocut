import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, SKILL_MAX_VERSIONS } from '@baocut/protocol';
import { SkillPrefsStore } from '@baocut/runtime-storage';
import { SkillCatalog } from './skill-catalog.ts';
import { SkillInstaller } from './skill-installer.ts';
import { writeSkill } from './testing/skill-fixtures.ts';

/** 架构设计 §3.8「版本」「上传包」：新建、复制、编辑、恢复、上传 zip 或文件夹与导出。 */

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('should have been rejected');
}

async function zipOf(file: string, entries: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(entries)) zip.file(name, body);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return file;
}

const SKILL_MD = (name: string, description = `${name} description`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

describe('skill editing and versions', () => {
  let dir: string;
  let builtin: string;
  let user: string;
  let catalog: SkillCatalog;
  let installer: SkillInstaller;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-skill-edit-'));
    builtin = path.join(dir, 'builtin');
    user = path.join(dir, 'home', 'skills');
    await fs.mkdir(builtin, { recursive: true });
    const prefs = new SkillPrefsStore(path.join(dir, 'home', 'store', 'skill-prefs.json'));
    await prefs.load();
    catalog = new SkillCatalog({ builtinDir: builtin, userDir: user, prefs });
    installer = new SkillInstaller({ catalog, offlineStrict: () => false });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('create writes a personal skill at revision 1 with the display title kept apart from name', async () => {
    const { skill } = await installer.create({ name: 'Brand Voice', title: '品牌语气', description: 'Tone\nrules', body: '\n\n# Steps\n' });
    expect(skill).toMatchObject({ id: 'brand-voice', name: 'brand-voice', title: '品牌语气', origin: 'personal', revision: 1 });
    expect(skill.source).toMatchObject({ kind: 'created', from: null });
    const md = await fs.readFile(path.join(user, 'brand-voice', 'SKILL.md'), 'utf8');
    expect(md).toBe('---\nname: brand-voice\ndescription: "Tone rules"\n---\n\n# Steps\n');
    expect((await catalog.versions('brand-voice')).versions).toMatchObject([{ revision: 1, kind: 'create', current: true }]);
    // 同名再建一个：取第一个空的副本 id。
    expect((await installer.create({ name: 'brand voice', description: 'x', body: '' })).skill.id).toBe('brand-voice-2');
  });

  it('write keeps the old files as a version, rejects a stale base revision, and restore saves a new version', async () => {
    await installer.create({ name: 'notes', description: 'Notes', body: 'v1 body\n' });
    const edited = await installer.write({
      id: 'notes',
      baseRevision: 1,
      note: 'tweak',
      changes: [
        { path: 'SKILL.md', text: SKILL_MD('notes', 'Notes v2') },
        { path: 'references/a.md', text: 'A' },
      ],
    });
    expect(edited.skill).toMatchObject({ revision: 2, description: 'Notes v2', fileCount: 2 });
    expect((await catalog.get('notes', 1)).content).toContain('v1 body');
    expect((await catalog.get('notes', 1)).files.map((f) => f.path)).toEqual(['SKILL.md']);
    expect((await catalog.readFile('notes', 'SKILL.md', 1)).content).toContain('v1 body');
    // 版本不进 skill 目录。
    expect((await fs.readdir(path.join(user, 'notes'))).filter((n) => !n.startsWith('.baocut'))).toEqual(['SKILL.md', 'references']);

    const stale = await rejection(installer.write({ id: 'notes', baseRevision: 1, changes: [{ path: 'x.md', text: 'x' }] }));
    expect(stale).toMatchObject({ code: 'conflict', details: { code: 'SKILL_REVISION_CONFLICT', revision: 2 } });
    const noSkillMd = await rejection(installer.write({ id: 'notes', baseRevision: 2, changes: [{ path: 'SKILL.md', remove: true }] }));
    expect(noSkillMd.details).toMatchObject({ code: 'SKILL_INVALID', path: 'SKILL.md' });

    const restored = await installer.restore({ id: 'notes', revision: 1 });
    expect(restored.skill).toMatchObject({ revision: 3, fileCount: 1 });
    const { versions } = await catalog.versions('notes');
    expect(versions.map((v) => [v.revision, v.kind, v.current])).toEqual([
      [3, 'restore', true],
      [2, 'edit', false],
      [1, 'create', false],
    ]);
    expect(versions[0]!.from).toBe(1);
    expect(versions[1]!.note).toBe('tweak');
    expect((await rejection(catalog.get('notes', 9))).details).toMatchObject({ code: 'SKILL_VERSION_NOT_FOUND' });
    // 没有留下暂存目录。
    expect(await fs.readdir(path.join(user, '.staging'))).toEqual([]);
  });

  it(`keeps at most ${SKILL_MAX_VERSIONS} versions, dropping the oldest`, async () => {
    await installer.create({ name: 'many', description: 'Many', body: 'start\n' });
    for (let rev = 1; rev <= SKILL_MAX_VERSIONS + 2; rev++) {
      await installer.write({ id: 'many', baseRevision: rev, changes: [{ path: 'n.md', text: String(rev) }] });
    }
    const { versions } = await catalog.versions('many');
    expect(versions).toHaveLength(SKILL_MAX_VERSIONS);
    expect(versions[0]!.revision).toBe(SKILL_MAX_VERSIONS + 3);
    expect(versions.at(-1)!.revision).toBe(4);
    const kept = await fs.readdir(path.join(user, '.versions', 'many'));
    expect(
      kept
        .filter((n) => /^\d+$/.test(n))
        .map(Number)
        .sort((a, b) => a - b)[0],
    ).toBe(4);
    // 移除时版本一并删掉。
    await installer.remove('many');
    await expect(fs.stat(path.join(user, '.versions', 'many'))).rejects.toThrow();
  });

  it('builtin and imported skills are not editable; duplicate makes a personal copy', async () => {
    await writeSkill(builtin, 'caption-layout', { files: { 'assets/logo.png': 'png', 'run.sh': 'echo' } });
    const blocked = await rejection(installer.write({ id: 'caption-layout', baseRevision: 1, changes: [] }));
    expect(blocked.details).toMatchObject({ code: 'SKILL_NOT_EDITABLE', origin: 'builtin' });
    const copy = await installer.duplicate({ id: 'caption-layout', title: 'My captions' });
    expect(copy.skill).toMatchObject({ id: 'caption-layout-2', origin: 'personal', title: 'My captions', revision: 1, fileCount: 3 });
    expect(copy.skill.source).toMatchObject({ kind: 'created', from: 'caption-layout' });
    expect((await catalog.versions('caption-layout-2')).versions[0]).toMatchObject({ kind: 'duplicate', from: 'caption-layout' });
    expect((await catalog.versions('caption-layout')).versions).toEqual([]);
  });

  it('inspects a zip: root skill, ignored entries, conflicts with update or copy, and installs by pick', async () => {
    await installer.create({ name: 'voice', description: 'Voice', body: 'old\n' });
    const zip = await zipOf(path.join(dir, 'in', 'voice.zip'), {
      'SKILL.md': SKILL_MD('voice', 'Voice v2'),
      'assets/logo.svg': '<svg/>',
      'scripts/run.py': 'print(1)',
      '__MACOSX/._SKILL.md': 'junk',
      '.DS_Store': 'junk',
    });
    const inspected = await installer.inspectPackage({ path: zip });
    expect(inspected).toMatchObject({ kind: 'zip', name: 'voice.zip' });
    expect(inspected.ignored.sort()).toEqual(['.DS_Store', '__MACOSX/']);
    expect(inspected.candidates).toHaveLength(1);
    expect(inspected.candidates[0]).toMatchObject({
      prefix: '',
      id: 'voice',
      fileCount: 3,
      assets: 1,
      scripts: 1,
      issue: null,
      conflict: { id: 'voice', origin: 'personal', canUpdate: true, nextRevision: 2, copyId: 'voice-2' },
    });

    const updated = await installer.installPackage({ path: zip, picks: [{ prefix: '', mode: 'update' }] });
    expect(updated.installed).toMatchObject([{ id: 'voice', revision: 2, description: 'Voice v2' }]);
    expect((await catalog.versions('voice')).versions[0]).toMatchObject({ kind: 'upload', note: 'voice.zip' });
    const copied = await installer.installPackage({ path: zip, picks: [{ prefix: '', mode: 'copy', title: 'Voice copy' }] });
    expect(copied.installed).toMatchObject([{ id: 'voice-2', title: 'Voice copy', revision: 1 }]);
    expect((await rejection(installer.installPackage({ path: zip, picks: [{ prefix: 'nope/', mode: 'new' }] }))).details).toMatchObject({
      code: 'SKILL_PACKAGE_INVALID',
    });
  });

  it('a zip of several skills lists each folder; unsafe and duplicate candidates carry an issue', async () => {
    const zip = await zipOf(path.join(dir, 'in', 'pack.zip'), {
      'pack/a/SKILL.md': SKILL_MD('alpha'),
      'pack/a/nested/SKILL.md': SKILL_MD('inner'),
      'pack/b/SKILL.md': SKILL_MD('beta', ''),
      'pack/c/SKILL.md': SKILL_MD('alpha'),
    });
    const { candidates } = await installer.inspectPackage({ path: zip });
    const byPrefix = Object.fromEntries(candidates.map((c) => [c.prefix, c]));
    expect(Object.keys(byPrefix).sort()).toEqual(['pack/a/', 'pack/b/', 'pack/c/']);
    // 嵌套的归外层。
    expect(byPrefix['pack/a/']).toMatchObject({ id: 'alpha', fileCount: 2, issue: null });
    expect(byPrefix['pack/b/']!.issue?.code).toBe('no-description');
    expect(byPrefix['pack/c/']!.issue?.code).toBe('invalid');
    const result = await installer.installPackage({ path: zip, picks: [{ prefix: 'pack/a/', mode: 'new' }] });
    expect(result.installed.map((s) => s.id)).toEqual(['alpha']);
    expect(await fs.readFile(path.join(user, 'alpha', 'nested', 'SKILL.md'), 'utf8')).toContain('inner');
  });

  it('a zip entry that climbs out of the folder is refused as unsafe', async () => {
    const file = path.join(dir, 'in', 'evil.zip');
    const zip = new JSZip();
    zip.file('SKILL.md', SKILL_MD('evil'));
    zip.file('../escape.md', 'x');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
    const { candidates } = await installer.inspectPackage({ path: file });
    expect(candidates[0]!.issue?.code).toBe('unsafe-path');
    expect((await rejection(installer.installPackage({ path: file, picks: [{ prefix: '', mode: 'new' }] }))).details).toMatchObject({
      code: 'SKILL_PACKAGE_INVALID',
      issue: { code: 'unsafe-path' },
    });
    await expect(fs.stat(path.join(dir, 'in', 'escape.md'))).rejects.toThrow();
  });

  it('uploads a folder and exports a skill to a zip without versions', async () => {
    const folder = await writeSkill(path.join(dir, 'src'), 'Folder Skill', { files: { 'references/r.md': 'R', '.git/HEAD': 'x' } });
    const inspected = await installer.inspectPackage({ path: folder });
    expect(inspected).toMatchObject({ kind: 'folder', ignored: ['.git/'] });
    const { installed } = await installer.installPackage({ path: folder, picks: [{ prefix: '', mode: 'new' }] });
    expect(installed).toMatchObject([{ id: 'folder-skill', fileCount: 2 }]);
    await installer.write({ id: 'folder-skill', baseRevision: 1, changes: [{ path: 'references/r.md', remove: true }] });
    // 删掉最后一个文件后空目录一并删掉。
    await expect(fs.stat(path.join(user, 'folder-skill', 'references'))).rejects.toThrow();

    await fs.mkdir(path.join(dir, 'out'));
    const out = path.join(dir, 'out', 'folder-skill.zip');
    expect(await installer.export({ id: 'folder-skill', path: out })).toEqual({ path: out });
    const zip = await JSZip.loadAsync(await fs.readFile(out));
    expect(
      Object.values(zip.files)
        .filter((f) => !f.dir)
        .map((f) => f.name),
    ).toEqual(['SKILL.md']);
  });
});
