import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findCargoBinary } from './cargo-target.ts';

const roots: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cargo-target-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function touch(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

describe('findCargoBinary', () => {
  it('finds the binary under the default target directory', () => {
    const root = tmp();
    touch(path.join(root, 'target/debug/tool'));
    expect(findCargoBinary(path.join(root, 'a/b'), 'tool', {})).toBe(path.join(root, 'target/debug/tool'));
  });

  it('follows build.target-dir from config.local.toml', () => {
    const root = tmp();
    const external = tmp();
    fs.mkdirSync(path.join(root, '.cargo'));
    fs.writeFileSync(path.join(root, '.cargo/config.local.toml'), `[build]\ntarget-dir = "${external}"\n`);
    touch(path.join(external, 'release/tool'));
    expect(findCargoBinary(path.join(root, 'a'), 'tool', {})).toBe(path.join(external, 'release/tool'));
  });

  it('prefers CARGO_TARGET_DIR and returns null when nothing is built', () => {
    const root = tmp();
    const env = tmp();
    touch(path.join(env, 'debug/tool'));
    expect(findCargoBinary(root, 'tool', { CARGO_TARGET_DIR: env })).toBe(path.join(env, 'debug/tool'));
    expect(findCargoBinary(root, 'nope', {})).toBeNull();
  });
});
