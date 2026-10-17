// Offline smoke check: run the built CLI with the shipped Electron, private HOME and no Runtime.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
if (!arg) throw new Error('Usage: check-bundled-cli.mjs --dev | <desktop app directory>');
const dev = arg === '--dev';
const app = dev ? null : realpathSync(path.resolve(arg));
const mac = process.platform === 'darwin';
const resources = dev ? null : path.join(app, mac ? 'Contents/Resources' : 'resources');
const entry = dev ? path.resolve(here, '../out/main/cli.js') : path.join(resources, 'app.asar', 'out/main/cli.js');
const command = dev ? (await import('electron')).default : path.join(app, mac ? 'Contents/MacOS/baocut-cli' : 'baocut.cmd');
const temp = mkdtempSync(path.join(os.tmpdir(), 'baocut-cli-check-'));
try {
  const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL'];
  const env = Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  Object.assign(env, { HOME: temp, USERPROFILE: temp, APPDATA: path.join(temp, 'roaming'), LOCALAPPDATA: path.join(temp, 'local'),
    BAOCUT_HOME: path.join(temp, 'runtime'), BAOCUT_LOCALE: 'en', TMPDIR: temp, TMP: temp, TEMP: temp });
  if (dev) {
    if (!existsSync(entry)) throw new Error(`Missing built CLI: ${entry}`);
    env.ELECTRON_RUN_AS_NODE = '1';
  } else if (!existsSync(command)) throw new Error(`Missing desktop CLI launcher: ${command}`);
  mkdirSync(env.APPDATA, {recursive: true}); mkdirSync(env.LOCALAPPDATA, {recursive: true});
  const invoke = (args) => {
    // The installed Windows launcher is a cmd shim, including paths containing spaces.
    const windowsShim = !dev && process.platform === 'win32';
    const program = windowsShim ? (env.ComSpec || 'cmd.exe') : command;
    const argv = dev ? [entry, ...args] : process.platform === 'win32' ? ['/d', '/s', '/c', `""${command}" ${args.join(' ')}"`] : args;
    const run = spawnSync(program, argv, {env, cwd: temp, encoding: 'utf8', timeout: 30_000, windowsHide: true, windowsVerbatimArguments: windowsShim, maxBuffer: 4 * 1024 * 1024});
    if (run.error || run.status !== 0) throw new Error(`CLI ${args.join(' ')} failed: ${run.error?.message || run.stderr || run.status}`);
    return run.stdout;
  };
  const version = JSON.parse(invoke(['version']));
  if (!version.cli?.interfaceVersion || version.runtime !== null) throw new Error('Offline version must report the CLI without starting a Runtime');
  const help = invoke(['--help']);
  if (!help.includes('baocut') || !help.includes('status')) throw new Error('Missing offline CLI help/catalog');
  const spec = JSON.parse(invoke(['spec']));
  if (spec.interfaceVersion !== version.cli.interfaceVersion || !spec.tools?.length) throw new Error('Missing offline CLI spec tools');
  if (resources) {
    const skills = JSON.parse(invoke(['skill', 'path']));
    const expected = path.join(resources, 'skills', 'baocut');
    if (path.normalize(skills.result?.sourceDir || '') !== path.normalize(expected)) throw new Error('CLI skill source does not belong to this app');
  }
  if (existsSync(path.join(env.BAOCUT_HOME, 'runtime.json'))) throw new Error('Offline CLI check unexpectedly started a Runtime');
  console.log(JSON.stringify({ok: true, cli: version.cli, offlineTools: spec.tools.length, runtimeStarted: false}));
} finally { rmSync(temp, {recursive: true, force: true}); }
