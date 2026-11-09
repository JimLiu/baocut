// `build-stamp.mjs` 的类型（Web 的 Vite 配置在类型检查范围里）。
import type { Plugin } from 'vite';

export const BUILD_STAMP_FILE: 'baocut-build.json';

export interface BuildStamp {
  schema: 1;
  component: string;
  build: string | null;
  protocolVersion: string | null;
  builtAt: string;
  outputs: string[];
  inputs: Record<string, string>;
}

export function hashFile(file: string): string;
export function repoBuild(root: string): string | null;
export function protocolVersion(root: string): string | null;
export function cargoTargetDir(root: string): string | null;
export function cargoDepInfo(file: string): string[];
export function withCargoManifests(root: string, inputs: readonly string[]): string[];
export function writeBuildStamp(options: {
  root: string;
  file: string;
  component: string;
  inputs: readonly string[];
  outputs: readonly string[];
  exclude?: readonly string[];
}): BuildStamp;
export function buildStampPlugin(options: { root: string; component: string; extraInputs?: readonly string[] }): Plugin;
