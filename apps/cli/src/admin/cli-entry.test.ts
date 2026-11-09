import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CliEntryStatus } from '@baocut/protocol';
import { CliError } from '../envelope.ts';
import { FakeClient, captureOutput } from '../testing/fake-client.ts';
import { cliEntry, cliInstallCommand, formatCliEntryStatus } from './cli-entry.ts';
import { AdminRun } from './context.ts';

const home = '/Users/a';
const app = '/Applications/BaoCut.app/Contents/MacOS/baocut-cli';
const link = `${home}/.local/bin/baocut`;

function status(extra: Partial<CliEntryStatus> = {}): CliEntryStatus {
  return {
    entry: app,
    path: link,
    state: 'none',
    target: null,
    managed: false,
    shell: { found: null, dirOnPath: false },
    pathHint: { line: 'export PATH="$HOME/.local/bin:$PATH"', file: '~/.zshrc' },
    ...extra,
  };
}

function run(args: string[], fake: FakeClient, json = true) {
  const capture = captureOutput(json);
  const ctx = new AdminRun({
    client: fake.client,
    output: capture.output,
    cwd: '/tmp',
    home: path.join('/tmp', 'home'),
    env: { HOME: home, PATH: '' },
    args,
    values: {},
    usage: cliEntry.usage,
  });
  return { capture, done: cliEntry.run(ctx as never) };
}

const rejected = (code: string) => (error: unknown) => error instanceof CliError && error.code === code;

describe('baocut cli', () => {
  it('install 只调 cliEntry.install，结果原样给出；不在 PATH 上时给要加的那一行', async () => {
    const fake = new FakeClient();
    const installed = status({ state: 'current', target: app, managed: true });
    fake.methods['cliEntry.install'] = () => installed;
    const json = run(['install'], fake);
    expect(await json.done).toBe(0);
    expect(fake.calls).toEqual([{ method: 'cliEntry.install', params: {} }]);
    expect(json.capture.envelope().result).toMatchObject({ state: 'current', path: link });

    const human = run(['install'], fake, false);
    expect(await human.done).toBe(0);
    const text = human.capture.out();
    expect(text).toContain('~/.local/bin/baocut');
    expect(text).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(text).toContain('~/.zshrc');
  });

  it('status 没装时下一步指向 cli install；remove 先读状态再删', async () => {
    const fake = new FakeClient();
    fake.methods['cliEntry.status'] = () => status();
    fake.methods['cliEntry.remove'] = () => status();
    const { capture, done } = run(['status'], fake);
    expect(await done).toBe(0);
    expect(JSON.stringify(capture.envelope())).toMatch(/baocut cli install/);
    expect(await run(['remove'], fake).done).toBe(0);
    expect(fake.calls.map((c) => c.method)).toEqual(['cliEntry.status', 'cliEntry.status', 'cliEntry.remove']);
  });

  it('不认识的动词与多余的参数是用法错误，不连 Runtime', async () => {
    const fake = new FakeClient();
    await expect(run(['link'], fake).done).rejects.toSatisfy(rejected('INVALID_ARGUMENTS'));
    await expect(run(['install', 'extra'], fake).done).rejects.toSatisfy(rejected('INVALID_ARGUMENTS'));
    expect(fake.calls).toEqual([]);
  });

  it('终端先找到别的 baocut 时点名它；查不出 PATH 时说查不出', () => {
    const shadowed = formatCliEntryStatus(
      status({ state: 'current', target: app, managed: true, shell: { found: '/opt/homebrew/bin/baocut', dirOnPath: true }, pathHint: null }),
      home,
    ).join('\n');
    expect(shadowed).toContain('/opt/homebrew/bin/baocut');
    expect(shadowed).toContain('~/.local/bin');
    const ours = formatCliEntryStatus(status({ state: 'current', target: app, shell: { found: link, dirOnPath: true }, pathHint: null }), home);
    const unchecked = formatCliEntryStatus(status({ shell: null, pathHint: null }), home);
    expect(ours).toHaveLength(3);
    expect(unchecked).toHaveLength(3);
    expect(unchecked[2]).not.toEqual(ours[2]);
  });

  it('装法命令：macOS 单引号包住 App 里的入口，Windows 双引号', () => {
    expect(cliInstallCommand(app, 'darwin')).toBe(`'${app}' cli install`);
    expect(cliInstallCommand("/Apps/It's/baocut-cli", 'darwin')).toBe(`'/Apps/It'\\''s/baocut-cli' cli install`);
    expect(cliInstallCommand('C:\\Program Files\\BaoCut\\baocut.cmd', 'win32')).toBe('"C:\\Program Files\\BaoCut\\baocut.cmd" cli install');
  });
});
