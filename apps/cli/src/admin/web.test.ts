import { describe, expect, it } from 'vitest';
import { CliError } from '../envelope.ts';
import { FakeClient, captureOutput } from '../testing/fake-client.ts';
import { AdminRun } from './context.ts';
import { M } from './services-copy.ts';
import { web } from './web.ts';

const link = {
  url: 'http://127.0.0.1:47622/review/vid_1#key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  video: 'vid_1',
  autostartEnabled: true,
};

function run(args: string[], values: Record<string, unknown>, fake: FakeClient, json = true) {
  const capture = captureOutput(json);
  const ctx = new AdminRun({ client: fake.client, output: capture.output, cwd: '/', args, values, usage: web.usage });
  return { capture, done: web.run(ctx as never) };
}

describe('baocut web review', () => {
  it('只发 services.web.reviewLink，原样打印链接；服务因此设为随 Runtime 启动时多一行说明', async () => {
    const fake = new FakeClient();
    fake.methods['services.web.reviewLink'] = () => link;
    const { capture, done } = run(['review'], { video: 'vid_1' }, fake, false);
    expect(await done).toBe(0);
    expect(fake.calls.map((call) => [call.method, call.params])).toEqual([['services.web.reviewLink', { video: 'vid_1' }]]);
    expect(capture.out().split('\n').slice(0, 3)).toEqual([link.url, M.reviewLinkNote, M.reviewAutostartOn]);

    fake.methods['services.web.reviewLink'] = () => ({ ...link, autostartEnabled: false });
    const again = run(['review'], { video: 'vid_1' }, fake);
    expect(await again.done).toBe(0);
    expect(again.capture.envelope().result.link.url).toBe(link.url);
    expect(again.capture.out()).not.toContain(M.reviewAutostartOn);
  });

  it('没给 --video、给了空的 --video 或 --launch 都是用法错误，不连 Runtime', async () => {
    for (const values of [{}, { video: ' ' }, { video: 'vid_1', launch: true }]) {
      const fake = new FakeClient();
      await expect(run(['review'], values, fake).done).rejects.toBeInstanceOf(CliError);
      expect(fake.calls).toEqual([]);
    }
  });
});
