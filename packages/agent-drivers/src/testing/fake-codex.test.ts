import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setImmediate } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { createFakeCodex } from './fake-codex.ts';

it('keeps scenarios readable while another process observes repeated updates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fake-codex-publish-'));
  const stopFile = path.join(dir, 'reader-stop');
  const fake = await createFakeCodex(dir, { turn: { reply: 'x'.repeat(128 * 1024) } });
  // A separate reader has the same filesystem race as a starting fake app-server.
  const reader = spawn(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    const [file, stop] = process.argv.slice(1);
    let reads = 0, errors = 0;
    const examples = [];
    function read() {
      try { JSON.parse(fs.readFileSync(file, 'utf8')); reads++; }
      catch (error) { errors++; if (examples.length < 3) examples.push(error.message); }
    }
    read();
    process.stdout.write('ready\\n');
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(stop) && Date.now() < deadline) read();
    const lastVersion = JSON.parse(fs.readFileSync(file, 'utf8')).version;
    process.stdout.write(JSON.stringify({ reads, errors, examples, lastVersion }) + '\\n');
  `, path.join(dir, 'scenario.json'), stopFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(reader, 'close');
  const lines = createInterface({ input: reader.stdout });
  let stderr = '';
  reader.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    expect((await once(lines, 'line'))[0]).toBe('ready');
    const resultLine = once(lines, 'line');
    for (let i = 1; i <= 256; i++) {
      fake.scenario({ version: `0.160.${i}` });
      await setImmediate();
    }
    await fs.writeFile(stopFile, 'done');
    const result = JSON.parse((await resultLine)[0] as string) as { reads: number; errors: number; examples: string[]; lastVersion: string };
    expect((await closed)[0], stderr).toBe(0);
    expect(result.reads).toBeGreaterThan(1);
    expect(result.examples).toEqual([]);
    expect(result.errors).toBe(0);
    expect(result.lastVersion).toBe('0.160.256');
  } finally {
    reader.kill('SIGKILL');
    await closed;
    lines.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
