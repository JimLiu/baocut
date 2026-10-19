import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type AgentSkillLocation } from '@baocut/protocol';
import { AGENT_SKILL_DIRS_FILE, AgentSkillInstaller, findCliOnPath } from './agent-skill-install.ts';

/** Agent 面设计 §8.2：给外部 Agent 装说明书的位置、状态与装法。 */

const skillMd = (name: string, version = '1.0.0', body = 'Use the CLI.') =>
  `---\nname: ${name}\ndescription: d\nversion: ${version}\n---\n\n${body}\n`;

function rejection(run: () => unknown): RpcError {
  try {
    run();
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('should have been rejected');
}

describe('agent skill installer', () => {
  let dir: string;
  let home: string;
  let user: string;
  let files: { path: string; content: string }[];
  let installer: AgentSkillInstaller;

  const at = (locations: AgentSkillLocation[], root: string | null, folder: string) =>
    locations.find((l) => l.root === root && l.folder === folder)!;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-agent-skill-')));
    home = path.join(dir, 'runtime-home');
    user = path.join(dir, 'user');
    fs.mkdirSync(user, { recursive: true });
    files = [
      { path: 'SKILL.md', content: skillMd('baocut') },
      { path: 'references/cli.md', content: '# CLI\n' },
    ];
    installer = new AgentSkillInstaller({ home, userHome: user, env: { PATH: '' }, platform: 'linux', render: () => files });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('开发时把渲染结果放进 Runtime Home；全局两处一开始都没有', () => {
    const status = installer.status();
    expect(status.source).toBe(path.join(home, 'agent-skills', 'baocut'));
    expect(status.bundled).toBe(false);
    expect(status.version).toBe('1.0.0');
    expect(fs.readFileSync(path.join(status.source, 'references', 'cli.md'), 'utf8')).toBe('# CLI\n');
    expect(status.locations.map((l) => [l.root, l.folder, l.state])).toEqual([
      [null, '.agents/skills', 'none'],
      [null, '.claude/skills', 'none'],
    ]);
    expect(status.dirs).toEqual([]);
  });

  it('随包的那份优先', () => {
    const bundled = path.join(dir, 'App', 'resources', 'agent-skill', 'baocut');
    fs.mkdirSync(bundled, { recursive: true });
    fs.writeFileSync(path.join(bundled, 'SKILL.md'), skillMd('baocut', '2.0.0'));
    const packaged = new AgentSkillInstaller({
      home,
      userHome: user,
      env: { PATH: '', BAOCUT_AGENT_SKILL_DIR: bundled },
      platform: 'linux',
      render: () => {
        throw new Error('should not render');
      },
    });
    expect(packaged.status()).toMatchObject({ source: bundled, bundled: true, version: '2.0.0' });
  });

  it('默认装软链接：指向来源，来源变了也跟着是最新的', () => {
    const status = installer.install([
      { root: null, folder: '.agents/skills', mode: 'link' },
      { root: null, folder: '.claude/skills', mode: 'link' },
    ]);
    const agents = at(status.locations, null, '.agents/skills');
    expect(agents).toMatchObject({ state: 'current', mode: 'link', version: '1.0.0', linkTarget: status.source });
    expect(agents.path).toBe(path.join(user, '.agents', 'skills', 'baocut'));
    expect(fs.lstatSync(agents.path).isSymbolicLink()).toBe(true);
    files = [{ path: 'SKILL.md', content: skillMd('baocut', '1.1.0', 'New text.') }];
    expect(at(installer.status().locations, null, '.claude/skills')).toMatchObject({ state: 'current', version: '1.1.0' });
  });

  it('副本：与来源逐字相同才是最新，不同是旧的；重装换回软链接', () => {
    installer.install([{ root: null, folder: '.claude/skills', mode: 'copy' }]);
    const target = path.join(user, '.claude', 'skills', 'baocut');
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(false);
    expect(at(installer.status().locations, null, '.claude/skills')).toMatchObject({ state: 'current', mode: 'copy', linkTarget: null });
    files = [{ path: 'SKILL.md', content: skillMd('baocut', '1.0.0', 'Changed.') }];
    expect(at(installer.status().locations, null, '.claude/skills')).toMatchObject({ state: 'stale', mode: 'copy', version: '1.0.0' });
    const relinked = installer.install([{ root: null, folder: '.claude/skills', mode: 'link' }]);
    expect(at(relinked.locations, null, '.claude/skills')).toMatchObject({ state: 'current', mode: 'link' });
  });

  it('软链接指向另一份 BaoCut 说明书是旧的，指向的位置不在了是失效', () => {
    const old = path.join(dir, 'old-render', 'baocut');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'SKILL.md'), skillMd('baocut', '0.9.0'));
    fs.mkdirSync(path.join(user, '.agents', 'skills'), { recursive: true });
    fs.symlinkSync(old, path.join(user, '.agents', 'skills', 'baocut'), 'dir');
    fs.mkdirSync(path.join(user, '.claude', 'skills'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'gone'), path.join(user, '.claude', 'skills', 'baocut'), 'dir');
    const status = installer.status();
    expect(at(status.locations, null, '.agents/skills')).toMatchObject({ state: 'stale', mode: 'link', version: '0.9.0', linkTarget: old });
    expect(at(status.locations, null, '.claude/skills')).toMatchObject({ state: 'broken', mode: 'link', version: null });
    // 修复：两处都换成指向来源的软链接，旧的那份不动。
    const fixed = installer.install([
      { root: null, folder: '.agents/skills', mode: 'link' },
      { root: null, folder: '.claude/skills', mode: 'link' },
    ]);
    expect(fixed.locations.map((l) => l.state)).toEqual(['current', 'current']);
    expect(fs.existsSync(path.join(old, 'SKILL.md'))).toBe(true);
  });

  it('不是 BaoCut 说明书的东西永不覆盖或删除：整批拒绝', () => {
    const theirs = path.join(user, '.claude', 'skills', 'baocut');
    fs.mkdirSync(theirs, { recursive: true });
    fs.writeFileSync(path.join(theirs, 'SKILL.md'), skillMd('someone-else'));
    expect(at(installer.status().locations, null, '.claude/skills')).toMatchObject({ state: 'foreign', mode: null });
    const error = rejection(() =>
      installer.install([
        { root: null, folder: '.agents/skills', mode: 'link' },
        { root: null, folder: '.claude/skills', mode: 'link' },
      ]),
    );
    expect(error.code).toBe('conflict');
    expect(error.details).toMatchObject({ code: 'AGENT_SKILL_LOCATION_TAKEN', path: theirs });
    expect(fs.existsSync(path.join(user, '.agents', 'skills', 'baocut'))).toBe(false);
    expect(rejection(() => installer.remove([{ root: null, folder: '.claude/skills' }])).code).toBe('conflict');
    expect(fs.readFileSync(path.join(theirs, 'SKILL.md'), 'utf8')).toContain('someone-else');
  });

  it('移除：软链接只删链接，来源不动；副本连文件一起删', () => {
    installer.install([
      { root: null, folder: '.agents/skills', mode: 'link' },
      { root: null, folder: '.claude/skills', mode: 'copy' },
    ]);
    const status = installer.remove([
      { root: null, folder: '.agents/skills' },
      { root: null, folder: '.claude/skills' },
    ]);
    expect(status.locations.map((l) => l.state)).toEqual(['none', 'none']);
    expect(fs.existsSync(path.join(status.source, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(user, '.claude', 'skills', 'baocut'))).toBe(false);
  });

  it('按目录装：任意文件夹，记住它；两处都没了就不再列', () => {
    const folder = path.join(dir, 'work', 'my-videos');
    fs.mkdirSync(folder, { recursive: true });
    const status = installer.install([
      { root: folder, folder: '.agents/skills', mode: 'link' },
      { root: `${folder}/`, folder: '.claude/skills', mode: 'link' },
    ]);
    expect(status.dirs).toEqual([folder]);
    expect(at(status.locations, folder, '.claude/skills')).toMatchObject({
      state: 'current',
      path: path.join(folder, '.claude', 'skills', 'baocut'),
    });
    expect(JSON.parse(fs.readFileSync(path.join(home, AGENT_SKILL_DIRS_FILE), 'utf8'))).toEqual({ dirs: [folder] });
    // 用户在外面删掉了一处：另一处还在，文件夹还列着。
    fs.rmSync(path.join(folder, '.agents', 'skills', 'baocut'));
    expect(installer.status().dirs).toEqual([folder]);
    // 只剩别的东西也不再列。
    fs.rmSync(path.join(folder, '.claude', 'skills', 'baocut'));
    fs.mkdirSync(path.join(folder, '.claude', 'skills', 'baocut'));
    fs.writeFileSync(path.join(folder, '.claude', 'skills', 'baocut', 'SKILL.md'), skillMd('mine'));
    const pruned = installer.status();
    expect(pruned.dirs).toEqual([]);
    expect(pruned.locations).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(path.join(home, AGENT_SKILL_DIRS_FILE), 'utf8'))).toEqual({ dirs: [] });
  });

  it('按目录装的根：展开 ~/，拒绝根目录、主目录、Agent 的配置目录与不存在的文件夹', () => {
    fs.mkdirSync(path.join(user, 'proj'), { recursive: true });
    expect(installer.normalizeRoot('~/proj')).toBe(path.join(user, 'proj'));
    for (const bad of ['/', '~', user, 'relative/dir', path.join(user, '.claude'), path.join(user, '.agents', 'skills')]) {
      expect(rejection(() => installer.normalizeRoot(bad)).details, bad).toMatchObject({ code: 'AGENT_SKILL_BAD_ROOT' });
    }
    const missing = rejection(() => installer.install([{ root: path.join(dir, 'nope'), folder: '.agents/skills', mode: 'link' }]));
    expect(missing.code).toBe('not-found');
    expect(missing.details).toMatchObject({ code: 'AGENT_SKILL_ROOT_NOT_FOUND' });
    fs.writeFileSync(path.join(dir, 'a-file'), 'x');
    expect(rejection(() => installer.normalizeRoot(path.join(dir, 'a-file'))).details).toMatchObject({ code: 'AGENT_SKILL_BAD_ROOT' });
  });

  it('终端里的 baocut：按 PATH 找，解析软链接，认出是不是 App 自带的入口', () => {
    const app = path.join(dir, 'BaoCut.app', 'Contents', 'MacOS');
    fs.mkdirSync(app, { recursive: true });
    const entry = path.join(app, 'baocut-cli');
    fs.writeFileSync(entry, '#!/bin/sh\n');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(entry, path.join(bin, 'baocut'));
    expect(findCliOnPath({ PATH: bin }, user, 'linux')).toBe(path.join(bin, 'baocut'));
    const withCli = new AgentSkillInstaller({
      home,
      userHome: user,
      env: { PATH: bin, BAOCUT_CLI_ENTRY: entry },
      platform: 'linux',
      render: () => files,
    });
    expect(withCli.cli()).toEqual({ entry, onPath: { path: path.join(bin, 'baocut'), target: entry, fromApp: true } });
    expect(installer.cli().entry).toBeNull();
  });
});
