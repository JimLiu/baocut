import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminBucket } from './admin/index.ts';
import { runCli } from './cli.ts';

/** 进程内跑 `runCli`：临时的 BAOCUT_HOME，Runtime 入口指向不存在的路径（万一要拉起也拉不起）。 */
let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-home-'));
  vi.stubEnv('BAOCUT_RUNTIME_ENTRY', path.join(home, 'no-such-runtime.ts'));
  vi.stubEnv('BAOCUT_LOCALE', 'en');
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

async function cli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks = { stdout: '', stderr: '' };
  stdout.on('data', (chunk) => (chunks.stdout += String(chunk)));
  stderr.on('data', (chunk) => (chunks.stderr += String(chunk)));
  const code = await runCli(argv, adminBucket, { cwd: home, env: { ...process.env, BAOCUT_HOME: home }, stdout, stderr });
  return { code, ...chunks };
}

describe('runCli：不为拼错的命令或帮助拉起 Runtime（Agent 面设计 §4.5）', () => {
  it('已知名词后不认识的动词：UNKNOWN_COMMAND（退出码 4），不拉起 Runtime', async () => {
    const result = await cli(['videos', 'frobnicate', '--json']);
    expect(result.code).toBe(4);
    expect(JSON.parse(result.stdout).error.code).toBe('UNKNOWN_COMMAND');
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('不认识的名词也一样', async () => {
    const result = await cli(['frobnicate', '--json']);
    expect(result.code).toBe(4);
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('只给名词：列出这一组', async () => {
    const result = await cli(['videos']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^baocut videos <command>\n[^]*\n  inspect /);
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('元命令的帮助：help runtime、runtime --help、help status、status --help、spec --help、version --help', async () => {
    for (const argv of [
      ['help', 'runtime'],
      ['runtime', '--help'],
      ['help', 'status'],
      ['status', '--help'],
      ['help', 'spec'],
      ['spec', '--help'],
      ['help', 'version'],
      ['version', '--help'],
      ['help', 'help'],
    ]) {
      const result = await cli(argv);
      expect(result.code, argv.join(' ')).toBe(0);
      expect(result.stdout, argv.join(' ')).toMatch(new RegExp(`^baocut ${argv.find((word) => word !== 'help') ?? 'help'}`));
    }
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('help videos delete 的示例带 --yes', async () => {
    const result = await cli(['help', 'videos', 'delete']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/baocut videos delete .*--yes/);
  });

  it('skill path 不连 Runtime；help skill、help mcp 有用法', async () => {
    const result = await cli(['skill', 'path', '--json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).result.hosts.map((host: { agent: string }) => host.agent)).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'gemini',
    ]);
    for (const noun of ['skill', 'mcp']) {
      const help = await cli(['help', noun]);
      expect(help.code, noun).toBe(0);
      expect(help.stdout, noun).toContain(`baocut ${noun} install --agent`);
    }
    expect(fs.readdirSync(home)).toEqual([]);
  });
});
