import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../envelope.ts';
import { FakeClient, captureOutput } from '../testing/fake-client.ts';
import { AdminRun } from './context.ts';
import { installAgentSkill, skill, skillPaths } from './skill.ts';

let root: string;
let env: NodeJS.ProcessEnv;
let home: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-skill-install-'));
  home = path.join(root, 'baocut-home');
  env = { HOME: path.join(root, 'user'), PATH: '', BAOCUT_AGENT_SKILLS_DIR: path.join(root, 'source') };
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const rendered = {
  interfaceVersion: 1,
  id: 'baocut',
  sourceDir: '/src/agent-skills/baocut',
  files: [
    { path: 'SKILL.md', content: '# BaoCut\n' },
    { path: 'references/start.md', content: '先 baocut status\n' },
  ],
};

function run(args: string[], values: Record<string, unknown>, fake: FakeClient | null) {
  const capture = captureOutput();
  const ctx = new AdminRun({
    client: fake?.client ?? null,
    output: capture.output,
    cwd: root,
    home,
    env,
    args,
    values,
    usage: skill.usage,
  });
  return { capture, done: skill.run(ctx as never) };
}

describe('installAgentSkill', () => {
  it('复制：写出全部文件；再装一次整个换掉', () => {
    const target = path.join(root, 'skills', 'baocut');
    expect(installAgentSkill(rendered, target, null)).toEqual({ mode: 'copy' });
    expect(fs.readFileSync(path.join(target, 'references', 'start.md'), 'utf8')).toBe('先 baocut status\n');
    fs.writeFileSync(path.join(target, 'stale.md'), 'x');
    installAgentSkill(rendered, target, null);
    expect(fs.readdirSync(target).sort()).toEqual(['SKILL.md', 'references']);
    expect(fs.readdirSync(path.dirname(target))).toEqual(['baocut']);
  });

  it('--link：渲染结果放进链接目录，目标是指向它的链接', () => {
    const target = path.join(root, 'skills', 'baocut');
    const linkDir = path.join(home, 'agent-skills', 'baocut');
    expect(installAgentSkill(rendered, target, linkDir)).toEqual({ mode: 'link', linkTo: linkDir });
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# BaoCut\n');
  });

  it('--link 在 Windows 上放 junction（不要管理员权限），其它平台放目录链接', () => {
    const target = path.join(root, 'skills', 'baocut');
    const linkDir = path.join(home, 'agent-skills', 'baocut');
    const symlink = vi.spyOn(fs, 'symlinkSync');
    try {
      // 非 Windows 上 Node 忽略链接类型，这里照样建得出来，只核对传给它的类型。
      installAgentSkill(rendered, target, linkDir, 'win32');
      expect(symlink).toHaveBeenLastCalledWith(linkDir, expect.any(String), 'junction');
      installAgentSkill(rendered, target, linkDir, 'darwin');
      expect(symlink).toHaveBeenLastCalledWith(linkDir, expect.any(String), 'dir');
    } finally {
      symlink.mockRestore();
    }
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# BaoCut\n');
  });

  it('替换已有的链接时只换链接，不动它指向的目录', () => {
    const other = path.join(root, 'v2-skill');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'SKILL.md'), '旧的');
    const target = path.join(root, 'skills', 'baocut');
    fs.mkdirSync(path.dirname(target));
    fs.symlinkSync(other, target, 'dir');
    installAgentSkill(rendered, target, null);
    expect(fs.lstatSync(target).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(other, 'SKILL.md'), 'utf8')).toBe('旧的');
  });

  it('越界的路径报错，旧的目标不动', () => {
    const target = path.join(root, 'skills', 'baocut');
    installAgentSkill(rendered, target, null);
    expect(() => installAgentSkill({ files: [{ path: '../escape.md', content: 'x' }] }, target, null)).toThrow(/越界/);
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# BaoCut\n');
    expect(fs.readdirSync(path.dirname(target))).toEqual(['baocut']);
  });
});

describe('baocut skill install', () => {
  it('装进宿主的 skills 目录（渲染结果来自 catalog.agentSkill）', async () => {
    const fake = new FakeClient();
    fake.methods['catalog.agentSkill'] = () => rendered;
    const { capture, done } = run(['install'], { agent: 'codex' }, fake);
    expect(await done).toBe(0);
    const target = path.join(env.HOME!, '.codex', 'skills', 'baocut');
    expect(capture.envelope().result).toEqual({
      agent: 'codex',
      target,
      mode: 'copy',
      replaced: false,
      sourceDir: rendered.sourceDir,
      files: 2,
    });
    expect(fs.existsSync(path.join(target, 'SKILL.md'))).toBe(true);
  });

  it('目标已存在、没给 --yes：CONFIRMATION_REQUIRED，不连 Runtime 取说明书', async () => {
    const target = path.join(env.HOME!, '.claude', 'skills', 'baocut');
    fs.mkdirSync(target, { recursive: true });
    const fake = new FakeClient();
    const { done } = run(['install'], { agent: 'claude-code' }, fake);
    await expect(done).rejects.toSatisfy((error: unknown) => error instanceof CliError && error.code === 'CONFIRMATION_REQUIRED');
    expect(fake.calls).toEqual([]);
  });

  it('--dir 不给 --agent 也行；两样都不给是用法错误', async () => {
    const fake = new FakeClient();
    fake.methods['catalog.agentSkill'] = () => rendered;
    const { capture, done } = run(['install'], { dir: 'custom', link: true }, fake);
    expect(await done).toBe(0);
    expect(capture.envelope().result).toMatchObject({ agent: null, target: path.join(root, 'custom', 'baocut'), mode: 'link' });
    await expect(run(['install'], {}, fake).done).rejects.toSatisfy(
      (error: unknown) => error instanceof CliError && error.code === 'INVALID_ARGUMENTS',
    );
  });
});

describe('baocut skill path', () => {
  it('来源与各宿主的位置，以及现在装了什么', () => {
    const target = path.join(env.HOME!, '.gemini', 'skills', 'baocut');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(path.join(root, 'elsewhere'), target);
    const paths = skillPaths(env, home);
    expect(paths.sourceDir).toBe(path.join(root, 'source', 'baocut'));
    expect(paths.linkDir).toBe(path.join(home, 'agent-skills', 'baocut'));
    expect(paths.hosts.map((host) => [host.agent, host.installed?.kind ?? null])).toEqual([
      ['claude-code', null],
      ['codex', null],
      ['cursor', null],
      ['gemini', 'link'],
    ]);
  });
});
