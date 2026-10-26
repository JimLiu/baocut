import { describe, expect, it } from 'vitest';
import { CliError } from '../envelope.ts';
import { FakeClient, captureOutput } from '../testing/fake-client.ts';
import { AdminRun } from './context.ts';
import { projects } from './projects.ts';

/** `baocut projects remove <项目>`：从 BaoCut 移除项目，目录不动（架构设计 §5.1）。 */

const project = { id: 'proj_1', name: '短片', path: '/work/短片', createdAt: 't', lastActiveAt: 't', pinned: false, archived: false };

function fakeRuntime(extra: Partial<typeof project> & { missing?: true } = {}): FakeClient {
  const fake = new FakeClient();
  fake.methods['projects.list'] = () => ({ projects: [{ ...project, ...extra }] });
  fake.methods['conversations.list'] = () => ({
    projects: [],
    conversations: [
      { id: 'conv_1', projectId: 'proj_1' },
      { id: 'conv_2', projectId: 'proj_1' },
      { id: 'conv_3', projectId: null },
    ],
  });
  fake.methods['projects.remove'] = () => ({ removed: true, conversations: 2 });
  return fake;
}

function run(args: string[], values: Record<string, unknown>, fake: FakeClient, json = true) {
  const capture = captureOutput(json);
  const ctx = new AdminRun({ client: fake.client, output: capture.output, cwd: '/work/短片', args, values, usage: projects.usage });
  return { capture, done: projects.run(ctx as never) };
}

describe('baocut projects remove', () => {
  it('给了 --yes：按名字找到项目，移除，报告删掉的会话数与目录', async () => {
    const fake = fakeRuntime();
    const { capture, done } = run(['remove', '短片'], { yes: true }, fake);
    expect(await done).toBe(0);
    expect(fake.calls.map((call) => call.method)).toEqual(['projects.list', 'conversations.list', 'projects.remove']);
    expect(fake.calls[2]!.params).toEqual({ projectId: 'proj_1' });
    expect(capture.envelope().result).toEqual({ removed: true, conversations: 2, projectId: 'proj_1', path: '/work/短片' });
    expect(capture.err()).toContain('/work/短片');
  });

  it('给人读：说明会删几个会话、目录留着；目录不在了时也说', async () => {
    const fake = fakeRuntime({ missing: true });
    const { capture, done } = run(['remove', 'proj_1'], { yes: true }, fake, false);
    expect(await done).toBe(0);
    const text = capture.err() + capture.out();
    expect(text).toContain('2 个会话');
    expect(text).toContain('目录已经不在了');
    expect(capture.out()).toContain('已从 BaoCut 移除 短片');
  });

  it('不在终端里又没给 --yes：CONFIRMATION_REQUIRED，不移除', async () => {
    const fake = fakeRuntime();
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      await expect(run(['remove', '短片'], {}, fake).done).rejects.toSatisfy(
        (error: unknown) => error instanceof CliError && error.code === 'CONFIRMATION_REQUIRED',
      );
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
    }
    expect(fake.calls.map((call) => call.method)).not.toContain('projects.remove');
  });

  it('没给项目：用法错误，不按当前目录猜', async () => {
    const fake = fakeRuntime();
    await expect(run(['remove'], { yes: true }, fake).done).rejects.toSatisfy(
      (error: unknown) => error instanceof CliError && error.code === 'INVALID_ARGUMENTS',
    );
    expect(fake.calls).toEqual([]);
  });
});
