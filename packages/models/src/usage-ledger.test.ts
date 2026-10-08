import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UsageRecord } from '@baocut/protocol';
import { UsageLedger } from './usage-ledger.ts';

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  at: '2026-10-06T08:00:00.000Z',
  providerId: 'anthropic',
  accountId: 'main',
  capability: 'generateText',
  modelId: 'claude-sonnet-5-5',
  source: 'job',
  ref: { jobId: 'job_1' },
  units: { inputTokens: 1000, outputTokens: 200 },
  cost: { kind: 'unknown' },
  durationMs: 1234,
  status: 'ok',
  ...overrides,
});

describe('UsageLedger', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-usage-'));
    file = path.join(dir, 'store', 'usage.jsonl');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('没有文件时是空账本；追加串行、一行一条、0600；读回同样的记录', async () => {
    const ledger = new UsageLedger(file);
    expect(await ledger.read()).toEqual([]);
    const records = Array.from({ length: 20 }, (_, i) => record({ durationMs: i }));
    await Promise.all(records.map((r) => ledger.append(r)));
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.readFile(file, 'utf8')).trim().split('\n')).toHaveLength(20);
    expect(await new UsageLedger(file).read()).toEqual(records);
  });

  it('坏的行（半行、认不出的字段）跳过并报告；验证的记录可以没有能力与模型', async () => {
    const warnings: Array<Record<string, unknown> | undefined> = [];
    const ledger = new UsageLedger(file, { warn: (_message, data) => warnings.push(data) });
    await ledger.append(record());
    await fs.appendFile(file, '{"at":"2026-10-06T08:00:00.000Z","providerId":\n');
    await fs.appendFile(file, `${JSON.stringify({ ...record(), source: 'nope' })}\n`);
    await fs.appendFile(file, `${JSON.stringify({ ...record(), capability: null })}\n`);
    await fs.appendFile(file, `${JSON.stringify({ ...record(), cost: { kind: 'reported', amount: '1.5', currency: 'EUR' } })}\n`);
    const verify = record({ capability: null, modelId: null, source: 'verify', accountId: null, units: {} });
    await ledger.append(verify);
    expect(await ledger.read()).toEqual([record(), verify]);
    expect(warnings).toEqual([{ skipped: 4 }]);
  });

  it('读不了（不是文件不存在）时抛出，不当作空账本；写不进去时报告、不抛出', async () => {
    await fs.mkdir(file, { recursive: true });
    const warnings: string[] = [];
    const ledger = new UsageLedger(file, { warn: (message) => warnings.push(message) });
    await expect(ledger.read()).rejects.toThrow();
    await expect(ledger.append(record())).resolves.toBeUndefined();
    expect(warnings).toEqual(["Couldn't write to the usage ledger"]);
  });
});
