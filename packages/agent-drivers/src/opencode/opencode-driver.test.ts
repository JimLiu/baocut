import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { createFakeOpenCode, type FakeOpenCode } from '../testing/fake-opencode.ts';
import { OpenCodeDriver } from './opencode-driver.ts';

/** OpenCode Driver 的探测，对着假 opencode：版本判定、模型表、账号说明、缓存与强制刷新。 */
describe('OpenCodeDriver.probe（假 opencode）', () => {
  let dir: string;
  let fake: FakeOpenCode;
  let driver: OpenCodeDriver;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-opencode-probe-'));
    fake = await createFakeOpenCode(path.join(dir, 'fake'));
    driver = new OpenCodeDriver(silentLogger, { locate: fake.locate, timeoutMs: 10_000 });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const serveStarts = () => fake.log().filter((e) => e.kind === 'start').length;

  it('2.x：就绪，模型表来自 serve，只有免费模型时说明怎么接入账号', async () => {
    const probe = await driver.probe();
    expect(probe.id).toBe('opencode');
    expect(probe.verified).toBe(true);
    expect(driver.verified).toBe(true);
    expect(driver.tested).toBe(true);
    expect(driver.describe().verified).toBe(true);
    expect(probe.state).toBe('ready');
    expect(probe.version).toBe('2.0.24');
    expect(probe.minVersion).toBe('2.0.10');
    expect(probe.capabilities).toEqual({ steer: true, approvals: true, resume: true, images: true });
    expect(probe.account).toBeNull();
    expect(probe.detail).toContain('opencode auth login');
    expect(probe.models.map((m) => m.id)).toEqual(['opencode/big-pickle', 'opencode/fledge-alpha-free']);
    expect(probe.models.find((m) => m.isDefault)?.id).toBe('opencode/fledge-alpha-free');
    expect(probe.models[1]!.efforts.map((e) => e.id)).toEqual(['low', 'high', 'max']);
    expect(probe.install.map((o) => o.command)).toEqual(['npm install -g @opencode/cli']);
    // 冷启动的目录先回空的插件表：读模型表之前等到它非空。
    const plugins = fake.requests('GET', '/api/plugin');
    expect(plugins.length).toBeGreaterThanOrEqual(2);
    expect(plugins[0]!.location).toBe(os.homedir());
    // 探测用的 serve 用完即关。
    await expect.poll(() => fake.log().filter((e) => e.kind === 'exit').length).toBe(1);
  });

  it('接入了别的 provider 时报账号', async () => {
    fake.scenario({
      providers: [
        { id: 'opencode', name: 'OpenCode Zen' },
        { id: 'anthropic', name: 'Anthropic', activation: 'enabled' },
      ],
    });
    const probe = await driver.probe();
    expect(probe.account).toBe('Anthropic');
    expect(probe.detail).toBeNull();
  });

  it('1.x：版本过低，请升级；不起 serve', async () => {
    fake.scenario({ versionOutput: '1.18.34' });
    const probe = await driver.probe();
    expect(probe.state).toBe('outdated');
    expect(probe.version).toBe('1.18.34');
    expect(probe.detail).toContain('版本过低，请升级');
    expect(probe.detail).toContain('@opencode/cli');
    expect(serveStarts()).toBe(0);
  });

  it('早于 2.0.10 的 2.x 也算过低', async () => {
    fake.scenario({ versionOutput: 'opencode v2.0.3' });
    expect((await driver.probe()).state).toBe('outdated');
  });

  it('没装：not-installed，并说怎么装', async () => {
    fake.scenario({ installed: false });
    const probe = await driver.probe();
    expect(probe.state).toBe('not-installed');
    expect(probe.detail).toContain('npm install -g @opencode/cli');
  });

  it('模型表读不出来：error', async () => {
    fake.scenario({ catalog: 'error' });
    const probe = await driver.probe();
    expect(probe.state).toBe('error');
    expect(probe.detail).toContain('catalog exploded');
  });

  it('模型表缓存 10 分钟，同时到来的探测共用一次；force 真的再查', async () => {
    await Promise.all([driver.probe(), driver.probe()]);
    await driver.probe();
    expect(serveStarts()).toBe(1);
    await driver.probe({ force: true });
    expect(serveStarts()).toBe(2);
  });
});
