import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, SKILL_LIMITS, SKILL_SOURCE_FILE } from '@baocut/protocol';
import { SkillPrefsStore } from '@baocut/runtime-storage';
import { SkillCatalog } from './skill-catalog.ts';
import { parseGithubSkillUrl } from './skill-github.ts';
import { SkillInstaller } from './skill-installer.ts';
import { writeSkill } from './testing/skill-fixtures.ts';

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('应该被拒绝');
}

const SHA = 'c'.repeat(40);
const SKILL_MD = '---\nname: Podcast chapters\ndescription: 给播客分章节\n---\n\n# 步骤\n';

/** 假的 GitHub：仓库 `o/r`，默认分支 main，文件按路径给出。记录请求过的地址。 */
function fakeGithub(files: Record<string, string>, options: { truncated?: boolean; symlink?: string; rateLimited?: boolean } = {}) {
  const requests: string[] = [];
  const trees = new Map<string, { path: string; mode: string; type: string; sha: string; size?: number }[]>();
  // 树的 sha 用目录路径表示：根是提交 sha。
  const dirs = new Set<string>(['']);
  for (const file of Object.keys(files)) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const treeSha = (dir: string) => (dir === '' ? SHA : `tree:${dir}`);
  const entriesUnder = (dir: string, recursive: boolean) => {
    const prefix = dir ? `${dir}/` : '';
    const out: { path: string; mode: string; type: string; sha: string; size?: number }[] = [];
    for (const d of dirs) {
      if (d === '' || !d.startsWith(prefix) || d === dir) continue;
      const rel = d.slice(prefix.length);
      if (!recursive && rel.includes('/')) continue;
      out.push({ path: rel, mode: '040000', type: 'tree', sha: treeSha(d) });
    }
    for (const [file, body] of Object.entries(files)) {
      if (!file.startsWith(prefix)) continue;
      const rel = file.slice(prefix.length);
      if (!recursive && rel.includes('/')) continue;
      const link = options.symlink === file;
      out.push({ path: rel, mode: link ? '120000' : '100644', type: 'blob', sha: `blob:${file}`, size: Buffer.byteLength(body) });
    }
    return out;
  };
  for (const d of dirs) trees.set(treeSha(d), entriesUnder(d, false));

  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (options.rateLimited) {
      return new Response('limit', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } });
    }
    const api = /^https:\/\/api\.test(\/repos\/o\/r)(\/.*)?$/.exec(url);
    if (api) {
      const rest = api[2] ?? '';
      if (rest === '') return Response.json({ default_branch: 'main' });
      if (rest === '/commits/main' || rest === `/commits/${SHA}`) return new Response(SHA);
      const tree = /^\/git\/trees\/([^?]+)(\?recursive=1)?$/.exec(rest);
      if (tree) {
        const sha = decodeURIComponent(tree[1]!);
        if (!trees.has(sha)) return new Response('', { status: 404 });
        const dir = sha === SHA ? '' : sha.slice('tree:'.length);
        return Response.json({ sha, tree: tree[2] ? entriesUnder(dir, true) : trees.get(sha), truncated: !!options.truncated });
      }
      return new Response('', { status: 404 });
    }
    const raw = new RegExp(`^https://raw\\.test/o/r/${SHA}/(.+)$`).exec(url);
    if (raw) {
      const file = raw[1]!.split('/').map(decodeURIComponent).join('/');
      if (file in files) return new Response(files[file]);
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { fetch: fakeFetch, requests };
}

describe('skill 的安装动作', () => {
  let dir: string;
  let builtin: string;
  let user: string;
  let prefs: SkillPrefsStore;
  let catalog: SkillCatalog;
  let offline: boolean;

  function installer(github?: ReturnType<typeof fakeGithub>): SkillInstaller {
    return new SkillInstaller({
      catalog,
      offlineStrict: () => offline,
      ...(github ? { github: { fetch: github.fetch, apiBase: 'https://api.test', rawBase: 'https://raw.test' } } : {}),
    });
  }

  async function staged(): Promise<string[]> {
    return fs.readdir(path.join(user, '.staging')).catch(() => []);
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-skill-install-'));
    builtin = path.join(dir, 'builtin');
    user = path.join(dir, 'home', 'skills');
    await fs.mkdir(builtin, { recursive: true });
    prefs = new SkillPrefsStore(path.join(dir, 'home', 'store', 'skill-prefs.json'));
    await prefs.load();
    catalog = new SkillCatalog({ builtinDir: builtin, userDir: user, prefs });
    offline = false;
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('从本地文件夹添加', () => {
    it('复制整个文件夹、记下来源，默认开着；不改原文件夹', async () => {
      const source = await writeSkill(path.join(dir, 'src'), 'Caption Layout', { files: { 'references/a.md': 'A', '.git/HEAD': 'x' } });
      const result = await installer().add({ path: source });
      expect(result.skill).toMatchObject({ id: 'caption-layout', origin: 'personal', enabled: true, removable: true, fileCount: 2 });
      expect(result.skill.path).toBe(path.join(user, 'caption-layout'));
      expect(result.skill.source).toMatchObject({ kind: 'local', path: source });
      expect(await fs.readFile(path.join(user, 'caption-layout', 'references', 'a.md'), 'utf8')).toBe('A');
      await expect(fs.access(path.join(user, 'caption-layout', '.git'))).rejects.toThrow();
      expect(JSON.parse(await fs.readFile(path.join(user, 'caption-layout', SKILL_SOURCE_FILE), 'utf8'))).toMatchObject({
        schemaVersion: 1,
        kind: 'local',
      });
      expect((await fs.readdir(source)).sort()).toEqual(['.git', 'SKILL.md', 'references']);
      expect(await staged()).toEqual([]);
    });

    it('已有同 id 的 skill（含内置的）时拒绝，不覆盖；可以另给 id', async () => {
      const source = await writeSkill(path.join(dir, 'src'), 'mine');
      await installer().add({ path: source });
      await fs.writeFile(path.join(user, 'mine', 'SKILL.md'), '---\nname: mine\ndescription: 已改过\n---\n');
      const again = await rejection(installer().add({ path: source }));
      expect(again.code).toBe('conflict');
      expect(again.details).toMatchObject({ code: 'SKILL_EXISTS', skillId: 'mine', path: path.join(user, 'mine'), source });
      expect(await fs.readFile(path.join(user, 'mine', 'SKILL.md'), 'utf8')).toContain('已改过');

      await writeSkill(builtin, 'caption-layout');
      const clash = await writeSkill(path.join(dir, 'src'), 'caption-layout');
      expect((await rejection(installer().add({ path: clash }))).details).toMatchObject({ code: 'SKILL_EXISTS' });
      expect((await installer().add({ path: clash, id: 'my-caption-layout' })).skill.id).toBe('my-caption-layout');
    });

    it('缺 SKILL.md、front matter 不合规、文件夹不存在、有符号链接时拒绝，不留下东西', async () => {
      const empty = path.join(dir, 'src', 'empty');
      await fs.mkdir(empty, { recursive: true });
      await fs.writeFile(path.join(empty, 'README.md'), 'x');
      expect((await rejection(installer().add({ path: empty }))).details).toMatchObject({
        code: 'SKILL_INVALID',
        path: path.join(user, 'empty'),
        source: empty,
      });

      const bad = await writeSkill(path.join(dir, 'src'), 'bad', { description: '' });
      expect((await rejection(installer().add({ path: bad }))).details).toMatchObject({
        code: 'SKILL_INVALID',
        path: path.join(user, 'bad'),
      });

      expect((await rejection(installer().add({ path: path.join(dir, 'nope') }))).details).toMatchObject({
        code: 'SKILL_SOURCE_NOT_FOUND',
      });

      const linked = await writeSkill(path.join(dir, 'src'), 'linked');
      await fs.symlink('/etc/hosts', path.join(linked, 'hosts'));
      expect((await rejection(installer().add({ path: linked }))).details).toMatchObject({ code: 'SKILL_INVALID' });

      expect((await fs.readdir(user)).filter((name) => name !== '.staging')).toEqual([]);
      expect(await staged()).toEqual([]);
    });

    it('超过文件数上限时拒绝', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i <= SKILL_LIMITS.files; i++) files[`refs/${i}.md`] = 'x';
      const big = await writeSkill(path.join(dir, 'src'), 'big', { files });
      expect((await rejection(installer().add({ path: big }))).details).toMatchObject({
        code: 'SKILL_TOO_LARGE',
        path: path.join(user, 'big'),
      });
    });

    it('不能把 skill 目录里的文件夹再添加一次', async () => {
      await installer().add({ path: await writeSkill(path.join(dir, 'src'), 'mine') });
      expect((await rejection(installer().add({ path: path.join(user, 'mine'), id: 'again' }))).details).toMatchObject({
        code: 'SKILL_INVALID',
      });
    });
  });

  describe('从 GitHub 导入', () => {
    it('解析地址：owner/repo、仓库首页、/tree/<ref>/<子目录>；别的拒绝', () => {
      expect(parseGithubSkillUrl('o/r')).toEqual({ owner: 'o', repo: 'r', ref: null, path: '', url: 'https://github.com/o/r' });
      expect(parseGithubSkillUrl('https://github.com/o/r.git/')).toMatchObject({ repo: 'r', ref: null });
      expect(parseGithubSkillUrl('https://github.com/o/r/tree/v1.0/skills/podcast-chapters?x=1#y')).toMatchObject({
        ref: 'v1.0',
        path: 'skills/podcast-chapters',
        url: 'https://github.com/o/r/tree/v1.0/skills/podcast-chapters',
      });
      for (const bad of ['', 'https://gitlab.com/o/r', 'o', 'https://github.com/o/r/blob/main/SKILL.md', 'o/r/tree/main/../x']) {
        expect(() => parseGithubSkillUrl(bad)).toThrow(
          expect.objectContaining({ details: expect.objectContaining({ code: 'SKILL_GITHUB_URL_INVALID' }) }),
        );
      }
    });

    it('导入仓库根：按提交下载，记下地址、ref 与提交，默认关着', async () => {
      const github = fakeGithub({ 'SKILL.md': SKILL_MD, 'references/a.md': 'A', '.github/workflow.yml': 'x' });
      const result = await installer(github).importGithub({ url: 'https://github.com/o/r' });
      expect(result.skill).toMatchObject({
        id: 'r',
        name: 'Podcast chapters',
        origin: 'third-party',
        enabled: false,
        removable: true,
        fileCount: 2,
      });
      expect(result.skill.source).toMatchObject({
        kind: 'github',
        url: 'https://github.com/o/r',
        owner: 'o',
        repo: 'r',
        ref: 'main',
        commit: SHA,
        path: '',
      });
      expect(await fs.readFile(path.join(user, 'r', 'references', 'a.md'), 'utf8')).toBe('A');
      await expect(fs.access(path.join(user, 'r', '.github'))).rejects.toThrow();
      expect(github.requests.filter((u) => u.startsWith('https://raw.test')).every((u) => u.includes(`/${SHA}/`))).toBe(true);
      expect(await staged()).toEqual([]);
    });

    it('导入子目录：id 取子目录名，只取这个目录', async () => {
      const github = fakeGithub({
        'README.md': 'repo',
        'skills/podcast-chapters/SKILL.md': SKILL_MD,
        'skills/podcast-chapters/refs/x.md': 'X',
        'skills/other/SKILL.md': SKILL_MD,
      });
      const result = await installer(github).importGithub({ url: 'https://github.com/o/r/tree/main/skills/podcast-chapters' });
      expect(result.skill).toMatchObject({ id: 'podcast-chapters', fileCount: 2 });
      expect(result.skill.source).toMatchObject({ ref: 'main', path: 'skills/podcast-chapters' });
      expect((await fs.readdir(path.join(user, 'podcast-chapters'))).sort()).toEqual([SKILL_SOURCE_FILE, 'SKILL.md', 'refs']);
      expect(github.requests.some((u) => u.includes('skills/other'))).toBe(false);
    });

    it('超过上限、缺 SKILL.md、含符号链接时在下载文件之前拒绝', async () => {
      const files: Record<string, string> = { 'SKILL.md': SKILL_MD };
      for (let i = 0; i < SKILL_LIMITS.files; i++) files[`refs/${i}.md`] = 'x';
      const tooMany = fakeGithub(files);
      expect((await rejection(installer(tooMany).importGithub({ url: 'o/r' }))).details).toMatchObject({
        code: 'SKILL_TOO_LARGE',
        path: path.join(user, 'r'),
        url: 'https://github.com/o/r',
      });
      expect(tooMany.requests.some((u) => u.startsWith('https://raw.test'))).toBe(false);

      const truncated = fakeGithub({ 'SKILL.md': SKILL_MD }, { truncated: true });
      expect((await rejection(installer(truncated).importGithub({ url: 'o/r' }))).details).toMatchObject({ code: 'SKILL_TOO_LARGE' });

      const missing = fakeGithub({ 'README.md': 'x', 'sub/SKILL.md': SKILL_MD });
      expect((await rejection(installer(missing).importGithub({ url: 'o/r' }))).details).toMatchObject({
        code: 'SKILL_INVALID',
        path: path.join(user, 'r'),
      });

      const linked = fakeGithub({ 'SKILL.md': SKILL_MD, 'link.md': '../../etc' }, { symlink: 'link.md' });
      expect((await rejection(installer(linked).importGithub({ url: 'o/r' }))).details).toMatchObject({ code: 'SKILL_INVALID' });

      expect((await fs.readdir(user)).filter((name) => name !== '.staging')).toEqual([]);
      expect(await staged()).toEqual([]);
    });

    it('目标已存在时在联网之前拒绝', async () => {
      await installer().add({ path: await writeSkill(path.join(dir, 'src'), 'r') });
      const github = fakeGithub({ 'SKILL.md': SKILL_MD });
      expect((await rejection(installer(github).importGithub({ url: 'o/r' }))).details).toMatchObject({
        code: 'SKILL_EXISTS',
        path: path.join(user, 'r'),
        source: 'https://github.com/o/r',
      });
      expect(github.requests).toEqual([]);
    });

    it('子目录不存在、限流、严格离线时如实拒绝', async () => {
      const github = fakeGithub({ 'SKILL.md': SKILL_MD });
      expect((await rejection(installer(github).importGithub({ url: 'https://github.com/o/r/tree/main/nope' }))).details).toMatchObject({
        code: 'SKILL_SOURCE_NOT_FOUND',
      });
      const limited = fakeGithub({ 'SKILL.md': SKILL_MD }, { rateLimited: true });
      expect((await rejection(installer(limited).importGithub({ url: 'o/r' }))).details).toMatchObject({
        code: 'SKILL_GITHUB_RATE_LIMITED',
        retryAt: new Date(1_800_000_000_000).toISOString(),
      });
      offline = true;
      const strict = fakeGithub({ 'SKILL.md': SKILL_MD });
      expect((await rejection(installer(strict).importGithub({ url: 'o/r' }))).details).toMatchObject({ code: 'OFFLINE_STRICT' });
      expect(strict.requests).toEqual([]);
      expect(await staged()).toEqual([]);
    });

    it('同一个 commandId 重试返回第一次的结果，不再下载', async () => {
      const github = fakeGithub({ 'SKILL.md': SKILL_MD });
      const inst = installer(github);
      const first = await inst.importGithub({ url: 'o/r', commandId: 'cmd-1' });
      const count = github.requests.length;
      expect(await inst.importGithub({ url: 'o/r', commandId: 'cmd-1' })).toBe(first);
      expect(github.requests.length).toBe(count);
    });
  });

  describe('移除', () => {
    it('删掉用户的 skill 目录并忘掉它的开关；内置的不能移除', async () => {
      await installer().add({ path: await writeSkill(path.join(dir, 'src'), 'mine') });
      await catalog.setEnabled('mine', false);
      const removed = await installer().remove('mine');
      expect(removed.removed).toEqual({ id: 'mine', path: path.join(user, 'mine') });
      expect(removed.skills).toEqual([]);
      await expect(fs.access(path.join(user, 'mine'))).rejects.toThrow();
      expect(prefs.get()).toEqual({ enabled: {} });

      await writeSkill(builtin, 'caption-layout');
      const refused = await rejection(installer().remove('caption-layout'));
      expect(refused.details).toMatchObject({ code: 'SKILL_BUILTIN_NOT_REMOVABLE', skillId: 'caption-layout' });
      await expect(fs.access(path.join(builtin, 'caption-layout', 'SKILL.md'))).resolves.toBeUndefined();
      expect((await rejection(installer().remove('nope'))).details).toMatchObject({ code: 'SKILL_NOT_FOUND' });
    });
  });
});
