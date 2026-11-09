import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cargoDepInfo, withCargoManifests, writeBuildStamp } from '../../../tools/build-stamp.mjs';
import { BUILD_STAMP_FILE, buildTargets, checkBuild, type BuildTarget } from './build-freshness.ts';

describe('build freshness (CLI standalone §7.4)', () => {
  let root: string;
  let out: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-build-')));
    fs.mkdirSync(path.join(root, 'packages', 'protocol', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages', 'protocol', 'src', 'wire.ts'), "export const PROTOCOL_VERSION = '9.1';\n");
    fs.mkdirSync(path.join(root, 'crates', 'a', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'crates', 'a', 'Cargo.toml'), '[package]\nname = "a"\n');
    fs.writeFileSync(path.join(root, 'crates', 'a', 'src', 'main.rs'), 'fn main() {}\n');
    fs.writeFileSync(path.join(root, 'crates', 'a', 'src', 'more file.rs'), '// x\n');
    fs.writeFileSync(path.join(root, 'Cargo.lock'), 'lock\n');
    out = path.join(root, 'target', 'debug');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'a'), 'binary');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const target = (component: BuildTarget['component'] = 'workers'): BuildTarget => ({
    component,
    dir: out,
    outputs: [path.join(out, 'a')],
    rebuild: 'npm run build:engine',
  });

  const stamp = (inputs: string[], component = 'workers') =>
    writeBuildStamp({ root, file: path.join(out, BUILD_STAMP_FILE), component, inputs, outputs: ['a'], exclude: [path.join(root, 'target')] });

  it('reads cargo dep-info with escaped spaces and adds the manifests', () => {
    const main = path.join(root, 'crates', 'a', 'src', 'main.rs');
    const spaced = path.join(root, 'crates', 'a', 'src', 'more file.rs');
    const generated = path.join(out, 'build', 'a-1', 'out', 'gen.rs');
    fs.writeFileSync(
      path.join(out, 'a.d'),
      `${path.join(out, 'a')}: ${main} ${spaced.replaceAll(' ', '\\ ')} ${generated}\n\n${main}:\n`,
    );
    const inputs = cargoDepInfo(path.join(out, 'a.d'));
    expect(inputs).toEqual([main, spaced, generated]);
    const written = stamp(withCargoManifests(root, inputs));
    // 产物目录里生成的源文件不记；清单与锁文件记上。
    expect(Object.keys(written.inputs)).toEqual(['Cargo.lock', 'crates/a/Cargo.toml', 'crates/a/src/main.rs', 'crates/a/src/more file.rs']);
    expect(written.protocolVersion).toBe('9.1');
  });

  it('is fresh until a recorded source changes, and lists what changed', async () => {
    stamp([path.join(root, 'crates', 'a', 'src', 'main.rs'), path.join(root, 'Cargo.lock')]);
    expect((await checkBuild(root, target(), '9.1')).state).toBe('fresh');

    fs.writeFileSync(path.join(root, 'crates', 'a', 'src', 'main.rs'), 'fn main() { println!(); }\n');
    const stale = await checkBuild(root, target(), '9.1');
    expect(stale).toMatchObject({ state: 'stale', reason: 'inputs', changed: ['crates/a/src/main.rs'], changedCount: 1, rebuild: 'npm run build:engine' });

    fs.rmSync(path.join(root, 'Cargo.lock'));
    expect((await checkBuild(root, target(), '9.1')).changedCount).toBe(2);
  });

  it('compares content, not modification times or the checkout', async () => {
    stamp([path.join(root, 'crates', 'a', 'src', 'main.rs')]);
    const file = path.join(root, 'crates', 'a', 'src', 'main.rs');
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(file, later, later);
    expect((await checkBuild(root, target(), '9.1')).state).toBe('fresh');

    // 另一份 checkout（worktree）借用同一份产物：内容一样就不算过期。
    const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-build-other-')));
    try {
      fs.mkdirSync(path.join(other, 'crates', 'a', 'src'), { recursive: true });
      fs.copyFileSync(file, path.join(other, 'crates', 'a', 'src', 'main.rs'));
      expect((await checkBuild(other, target(), '9.1')).state).toBe('fresh');
      fs.writeFileSync(path.join(other, 'crates', 'a', 'src', 'main.rs'), 'changed\n');
      expect((await checkBuild(other, target(), '9.1')).state).toBe('stale');
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('cannot verify a build without a stamp or with an output newer than its stamp', async () => {
    expect(await checkBuild(root, target(), '9.1')).toMatchObject({ state: 'unverified', reason: 'no-stamp', build: null });

    stamp([path.join(root, 'crates', 'a', 'src', 'main.rs')]);
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(out, 'a'), later, later);
    expect(await checkBuild(root, target(), '9.1')).toMatchObject({ state: 'unverified', reason: 'output-newer' });
  });

  it('marks a web build of another protocol version stale', async () => {
    stamp([path.join(root, 'crates', 'a', 'src', 'main.rs')], 'web');
    expect(await checkBuild(root, target('web'), '9.2')).toMatchObject({ state: 'stale', reason: 'protocol', protocolVersion: '9.1' });
    // Worker 不比协议版本。
    expect((await checkBuild(root, target('workers'), '9.2')).state).toBe('fresh');
  });

  it('groups workers by directory and names the rebuild command', () => {
    const release = path.join(root, 'target', 'release');
    const targets = buildTargets(root, {
      workers: [path.join(out, 'engine-host'), path.join(out, 'export-worker'), path.join(release, 'model-worker'), null],
      editorWasm: path.join(root, 'packages', 'editor-wasm', 'src', 'generated', 'editor.wasm'),
      web: path.join(root, 'apps', 'web', 'dist'),
    });
    expect(targets.map((t) => [t.component, path.relative(root, t.dir), t.outputs.length, t.rebuild])).toEqual([
      ['workers', 'target/debug', 2, 'npm run build:engine'],
      ['workers', 'target/release', 1, 'npm run build:engine -- --release'],
      ['editor-wasm', 'packages/editor-wasm/src/generated', 1, 'npm run build:wasm && npm run build:web'],
      ['web', 'apps/web/dist', 1, 'npm run build:web'],
    ]);
  });
});
