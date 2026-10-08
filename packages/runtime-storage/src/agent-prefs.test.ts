import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentPrefsStore, defaultAgentPreferences } from './agent-prefs.ts';

describe('Agent 偏好', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-agent-prefs-'));
    file = path.join(dir, 'store', 'agent-prefs.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('没有文件时是默认值', async () => {
    expect(await new AgentPrefsStore(file).load()).toEqual(defaultAgentPreferences());
  });

  it('改了落盘，重新读回来一样', async () => {
    const store = new AgentPrefsStore(file);
    await store.load();
    await store.update((p) => {
      p.drivers.claude = { enabled: true, defaultModel: 'opus', defaultEffort: 'high', executable: null };
      p.rules.push('bcut cleanup', 'bcut cleanup', 'npm');
    });
    const again = await new AgentPrefsStore(file).load();
    expect(again).toMatchObject({ rules: ['bcut cleanup', 'npm'] });
    expect(again.drivers.claude).toEqual({ enabled: true, defaultModel: 'opus', defaultEffort: 'high', executable: null });
    expect(store.driver('codex')).toEqual({ enabled: true, defaultModel: null, defaultEffort: null, executable: null });
  });

  it('坏掉或不认识的字段按默认处理', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        defaultDriverId: 'gemini',
        lastAccessMode: 'controlled',
        policy: { read: false, bcutro: 'yes' },
        drivers: { codex: { enabled: false, defaultModel: '' }, 'Not Valid': { enabled: true }, kimi: { enabled: false, defaultModel: 'kimi-k3' } },
        rules: ['ok', 3, ''],
      }),
    );
    const prefs = await new AgentPrefsStore(file).load();
    expect(prefs).not.toHaveProperty('defaultDriverId');
    expect(prefs).not.toHaveProperty('lastAccessMode');
    expect(prefs.policy).toEqual({ read: false, bcutro: true, loop: true });
    // 经 ACP 接入的 Agent（kimi）照常读回；id 写法不对的丢掉。
    expect(prefs.drivers).toEqual({
      codex: { enabled: false, defaultModel: null, defaultEffort: null, executable: null },
      kimi: { enabled: false, defaultModel: 'kimi-k3', defaultEffort: null, executable: null },
    });
    expect(prefs.rules).toEqual(['ok']);
  });

  it('读不了的 JSON 不拦启动', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json');
    expect(await new AgentPrefsStore(file).load()).toEqual(defaultAgentPreferences());
  });
});
