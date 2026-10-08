import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { devSpawnOptions, SHUTDOWN_SIGNALS, STOP_SIGNAL } from './dev-process-group.mjs';

const POSIX = process.platform !== 'win32';

// Stands in for Electron: records its pid once its signal handlers are in place and which signal asked it to quit; `quits`
// then exits, `hangs` does not (like a main process blocked by a modal error box).
const FAKE_ELECTRON = `
const fs = require('node:fs');
const [pidFile, mode] = process.argv.slice(1);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    fs.writeFileSync(pidFile + '.stop', signal);
    if (mode === 'quits') process.exit(0);
  });
}
fs.writeFileSync(pidFile, JSON.stringify({ dev: process.ppid, electron: process.pid }));
setInterval(() => {}, 1000);
`;

// Stands in for electron-vite: starts the fake Electron and, like electron-vite, ends on SIGINT or SIGTERM without stopping it.
// SIGUSR2 makes it exit by itself with code 3 (the app was closed, or the build failed).
const FAKE_DEV = `
const { spawn } = require('node:child_process');
const [pidFile, mode, electronSource] = process.argv.slice(1);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGUSR2', () => process.exit(3));
spawn(process.execPath, ['-e', electronSource, '--', pidFile, mode], { stdio: 'inherit' });
setInterval(() => {}, 1000);
`;

const RUNNER = `
import { superviseDevProcess } from ${JSON.stringify(new URL('./dev-process-group.mjs', import.meta.url).href)};
const [forceKillMs, ...args] = process.argv.slice(1);
superviseDevProcess(process.execPath, args, { forceKillMs: Number(forceKillMs) });
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

/** Starts the runner around the fake electron-vite / Electron pair and waits until the fake Electron is up. */
async function startRunner(t, { electron, forceKillMs }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'baocut-dev-runner-'));
  const pidFile = path.join(dir, 'pids.json');
  const runner = spawn(
    process.execPath,
    ['--input-type=module', '-e', RUNNER, '--', String(forceKillMs), '-e', FAKE_DEV, '--', pidFile, electron, FAKE_ELECTRON],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  runner.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => runner.on('exit', (code, signal) => resolve({ code, signal, at: Date.now() })));
  t.after(() => {
    runner.kill('SIGKILL');
    if (existsSync(pidFile)) {
      const { dev, electron: electronPid } = JSON.parse(readFileSync(pidFile, 'utf8'));
      for (const pid of [dev, electronPid]) if (alive(pid)) process.kill(pid, 'SIGKILL');
    }
    rmSync(dir, { recursive: true, force: true });
  });
  await until(() => existsSync(pidFile), 10_000, 'the fake Electron to start');
  const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
  return { runner, pids, pidFile, exited, stderr: () => stderr };
}

test('the dev processes get their own process group on POSIX, and keep the terminal for output', () => {
  for (const platform of ['darwin', 'linux']) assert.deepEqual(devSpawnOptions(platform), { stdio: 'inherit', detached: true });
  // A detached child on Windows gets its own console window, out of reach of Ctrl+C.
  assert.deepEqual(devSpawnOptions('win32'), { stdio: 'inherit', detached: false });
});

for (const signal of SHUTDOWN_SIGNALS) {
  test(`${signal} reaches Electron behind electron-vite, and the runner exits once both are gone`, { skip: !POSIX }, async (t) => {
    const { runner, pids, pidFile, exited } = await startRunner(t, { electron: 'quits', forceKillMs: 10_000 });
    const sentAt = Date.now();
    runner.kill(signal);
    const { code, at } = await exited;

    assert.equal(code, 0);
    assert.ok(at - sentAt < 5_000, `exited ${at - sentAt} ms after ${signal}; should not wait for the force-kill deadline`);
    // Whatever the runner got, the group gets what a Ctrl+C in the terminal sends it.
    assert.equal(readFileSync(`${pidFile}.stop`, 'utf8'), STOP_SIGNAL);
    await until(() => !alive(pids.dev) && !alive(pids.electron), 2_000, 'electron-vite and Electron to exit');
  });
}

test('force-kills an Electron that does not quit, then exits', { skip: !POSIX }, async (t) => {
  const forceKillMs = 300;
  const { runner, pids, pidFile, exited, stderr } = await startRunner(t, { electron: 'hangs', forceKillMs });
  const sentAt = Date.now();
  runner.kill('SIGHUP');
  const { code, at } = await exited;

  assert.equal(code, 0);
  assert.ok(at - sentAt >= forceKillMs, 'waited for the deadline before force-killing');
  assert.equal(readFileSync(`${pidFile}.stop`, 'utf8'), STOP_SIGNAL, 'Electron was asked to quit first');
  assert.match(stderr(), /force-killing/);
  await until(() => !alive(pids.electron), 2_000, 'the hung Electron to be killed');
});

test('passes on the exit code when electron-vite exits by itself, and stops what it left behind', { skip: !POSIX }, async (t) => {
  const { pids, pidFile, exited } = await startRunner(t, { electron: 'quits', forceKillMs: 10_000 });
  process.kill(pids.dev, 'SIGUSR2');
  const { code } = await exited;

  assert.equal(code, 3);
  assert.equal(readFileSync(`${pidFile}.stop`, 'utf8'), STOP_SIGNAL, 'Electron was asked to quit');
  await until(() => !alive(pids.electron), 2_000, 'Electron to exit');
});
