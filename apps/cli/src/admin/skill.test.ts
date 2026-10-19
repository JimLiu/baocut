import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentSkillLocation, AgentSkillStatus } from '@baocut/protocol';
import { CliError } from '../envelope.ts';
import { FakeClient, captureOutput } from '../testing/fake-client.ts';
import { AdminRun } from './context.ts';
import { formatSkillStatus, skill, skillTargets } from './skill.ts';

let root: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-skill-'));
  env = { HOME: path.join(root, 'user'), PATH: '' };
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const source = '/Applications/BaoCut.app/Contents/Resources/agent-skill/baocut';

function location(root: string | null, folder: AgentSkillLocation['folder'], extra: Partial<AgentSkillLocation> = {}): AgentSkillLocation {
  return {
    root,
    folder,
    path: path.join(root ?? env.HOME!, ...folder.split('/'), 'baocut'),
    state: 'none',
    mode: null,
    version: null,
    linkTarget: null,
    ...extra,
  };
}

function status(locations: AgentSkillLocation[], dirs: string[] = []): AgentSkillStatus {
  return {
    version: '1.0.0',
    source,
    bundled: true,
    appOutsideApplications: false,
    cli: { entry: '/Applications/BaoCut.app/Contents/MacOS/baocut-cli', onPath: null },
    locations,
    dirs,
  };
}

function run(args: string[], values: Record<string, unknown>, fake: FakeClient, json = true) {
  const capture = captureOutput(json);
  const ctx = new AdminRun({
    client: fake.client,
    output: capture.output,
    cwd: root,
    home: path.join(root, 'home'),
    env,
    args,
    values,
    usage: skill.usage,
  });
  return { capture, done: skill.run(ctx as never) };
}

const rejected = (code: string) => (error: unknown) => error instanceof CliError && error.code === code;

describe('skillTargets', () => {
  it('默认全局两处；--dir 换成每个文件夹两处；--agent 只要一处', () => {
    expect(skillTargets([], undefined)).toEqual([
      { root: null, folder: '.agents/skills' },
      { root: null, folder: '.claude/skills' },
    ]);
    expect(skillTargets(['/a', '/b', '/a'], 'claude')).toEqual([
      { root: '/a', folder: '.claude/skills' },
      { root: '/b', folder: '.claude/skills' },
    ]);
    expect(() => skillTargets([], 'codex')).toThrow(/agents.*claude/);
  });
});

describe('baocut skill install', () => {
  it('默认全局两处、软链接；结果带装好的位置', async () => {
    const fake = new FakeClient();
    const installed = status([
      location(null, '.agents/skills', { state: 'current', mode: 'link', version: '1.0.0', linkTarget: source }),
      location(null, '.claude/skills', { state: 'current', mode: 'link', version: '1.0.0', linkTarget: source }),
    ]);
    fake.methods['agentSkill.install'] = () => installed;
    const { capture, done } = run(['install'], {}, fake);
    expect(await done).toBe(0);
    expect(fake.calls).toEqual([
      {
        method: 'agentSkill.install',
        params: {
          targets: [
            { root: null, folder: '.agents/skills', mode: 'link' },
            { root: null, folder: '.claude/skills', mode: 'link' },
          ],
        },
      },
    ]);
    expect(capture.envelope().result).toMatchObject({ installed: installed.locations.map((l) => l.path) });
  });

  it('--dir 按工作目录解析，--copy 复制', async () => {
    const fake = new FakeClient();
    fake.methods['agentSkill.install'] = () => status([]);
    const { done } = run(['install'], { dir: ['work'], agent: 'agents', copy: true }, fake);
    expect(await done).toBe(0);
    expect(fake.calls[0]?.params).toEqual({ targets: [{ root: path.join(root, 'work'), folder: '.agents/skills', mode: 'copy' }] });
  });

  it('不认识的 --agent 与多余的参数是用法错误，不连 Runtime', async () => {
    const fake = new FakeClient();
    await expect(run(['install'], { agent: 'cursor' }, fake).done).rejects.toSatisfy(rejected('INVALID_ARGUMENTS'));
    await expect(run(['install', 'extra'], {}, fake).done).rejects.toSatisfy(rejected('INVALID_ARGUMENTS'));
    await expect(run(['path'], {}, fake).done).rejects.toSatisfy(rejected('INVALID_ARGUMENTS'));
    expect(fake.calls).toEqual([]);
  });
});

describe('baocut skill remove', () => {
  it('软链接直接移除；有副本时要 --yes', async () => {
    const fake = new FakeClient();
    const before = status([
      location(null, '.agents/skills', { state: 'current', mode: 'link', linkTarget: source }),
      location(null, '.claude/skills', { state: 'stale', mode: 'copy' }),
    ]);
    fake.methods['agentSkill.status'] = () => before;
    fake.methods['agentSkill.remove'] = () => status([location(null, '.agents/skills'), location(null, '.claude/skills')]);
    expect(await run(['remove'], { agent: 'agents' }, fake).done).toBe(0);
    expect(fake.calls.map((c) => c.method)).toEqual(['agentSkill.status', 'agentSkill.remove']);
    await expect(run(['remove'], {}, fake).done).rejects.toSatisfy(rejected('CONFIRMATION_REQUIRED'));
    expect(fake.calls.filter((c) => c.method === 'agentSkill.remove')).toHaveLength(1);
    expect(await run(['remove'], { yes: true }, fake).done).toBe(0);
    expect(fake.calls.filter((c) => c.method === 'agentSkill.remove')).toHaveLength(2);
  });
});

describe('baocut skill status', () => {
  it('应用自带的版本、命令行、全局与各文件夹的每一处；有过期的给下一步', async () => {
    const fake = new FakeClient();
    const dir = path.join(root, 'proj');
    fake.methods['agentSkill.status'] = () =>
      status(
        [
          location(null, '.agents/skills', { state: 'current', mode: 'link', version: '1.0.0', linkTarget: source }),
          location(null, '.claude/skills'),
          location(dir, '.agents/skills', { state: 'stale', mode: 'copy', version: '0.9.0' }),
          location(dir, '.claude/skills', { state: 'broken', mode: 'link' }),
        ],
        [dir],
      );
    const { capture, done } = run(['status'], {}, fake, false);
    expect(await done).toBe(0);
    const text = capture.out();
    expect(text).toContain('1.0.0');
    expect(text).toContain('/Applications/BaoCut.app/Contents/MacOS/baocut-cli');
    expect(text).toContain('~/.agents/skills/baocut');
    expect(text).toContain(dir);
    expect(text).toMatch(/baocut skill install/);
  });

  it('不在 PATH 上：macOS 给软链接命令，Windows 让把安装目录加进 PATH', () => {
    const base = status([location(null, '.agents/skills'), location(null, '.claude/skills')]);
    expect(formatSkillStatus(base, env, 'darwin').join('\n')).toContain(
      "ln -sf '/Applications/BaoCut.app/Contents/MacOS/baocut-cli' /usr/local/bin/baocut",
    );
    const win = { ...base, cli: { entry: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\baocut.cmd', onPath: null } };
    expect(formatSkillStatus(win, env, 'win32').join('\n')).toContain('C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut');
    const onPath = { ...base, cli: { ...base.cli, onPath: { path: '/usr/local/bin/baocut', target: base.cli.entry, fromApp: true } } };
    expect(formatSkillStatus(onPath, env, 'darwin').join('\n')).toContain('/usr/local/bin/baocut → /Applications/BaoCut.app');
  });
});
