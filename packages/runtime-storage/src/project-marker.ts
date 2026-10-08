import fs from 'node:fs/promises';
import path from 'node:path';
import type { Id } from '@baocut/protocol';
import { writeJsonAtomic } from './json-file.ts';
import { RuntimeStorageFiles as SF } from '@baocut/protocol/messages/runtime-storage';

/**
 * 项目标记 `<项目目录>/.bcut/project.json`（架构设计 §5.1）：项目的标识在目录里，登记只是索引。
 * 标记目录只放 BaoCut 自己的项目级状态，不放用户内容。
 */

export const PROJECT_MARKER_DIR = '.bcut';
export const PROJECT_MARKER_FILE = 'project.json';
export const PROJECT_MARKER_FORMAT = 'baocut.project';
export const PROJECT_MARKER_SCHEMA_VERSION = 1;

export interface ProjectMarker {
  format: typeof PROJECT_MARKER_FORMAT;
  schemaVersion: typeof PROJECT_MARKER_SCHEMA_VERSION;
  projectId: Id;
  createdAt: string;
}

export type ProjectMarkerRead =
  | { kind: 'none' }
  | { kind: 'ok'; marker: ProjectMarker }
  /** 读得到但认不出：不是 JSON、`format` 不对、缺字段。 */
  | { kind: 'corrupt'; reason: string }
  /** 比这个版本认识的更新：不能理解，也不能改写。 */
  | { kind: 'unsupported'; schemaVersion: number };

const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function projectMarkerPath(dir: string): string {
  return path.join(dir, PROJECT_MARKER_DIR, PROJECT_MARKER_FILE);
}

/** 读项目标记。没有文件是 `none`；读不了（权限等）的错误照常抛出。 */
export async function readProjectMarker(dir: string): Promise<ProjectMarkerRead> {
  let text: string;
  try {
    text = await fs.readFile(projectMarkerPath(dir), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'none' };
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: 'corrupt', reason: SF.markerNotJson().text };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { kind: 'corrupt', reason: SF.markerNotObject().text };
  const record = data as Record<string, unknown>;
  if (record.format !== PROJECT_MARKER_FORMAT) return { kind: 'corrupt', reason: SF.markerFormat({ format: PROJECT_MARKER_FORMAT }).text };
  const version = record.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { kind: 'corrupt', reason: SF.markerSchemaVersion().text };
  if (version > PROJECT_MARKER_SCHEMA_VERSION) return { kind: 'unsupported', schemaVersion: version };
  if (typeof record.projectId !== 'string' || !PROJECT_ID.test(record.projectId)) return { kind: 'corrupt', reason: SF.markerProjectId().text };
  const createdAt = typeof record.createdAt === 'string' && !Number.isNaN(Date.parse(record.createdAt)) ? record.createdAt : null;
  if (!createdAt) return { kind: 'corrupt', reason: SF.markerCreatedAt().text };
  return {
    kind: 'ok',
    marker: { format: PROJECT_MARKER_FORMAT, schemaVersion: PROJECT_MARKER_SCHEMA_VERSION, projectId: record.projectId, createdAt },
  };
}

/** 原子写入项目标记。 */
export async function writeProjectMarker(dir: string, projectId: Id, createdAt: string): Promise<ProjectMarker> {
  const marker: ProjectMarker = {
    format: PROJECT_MARKER_FORMAT,
    schemaVersion: PROJECT_MARKER_SCHEMA_VERSION,
    projectId,
    createdAt,
  };
  await writeJsonAtomic(projectMarkerPath(dir), marker);
  return marker;
}

/** 认不出的标记改名保留（`project.json.corrupt-<时间>`），不静默覆盖。返回改名后的路径。 */
export async function quarantineProjectMarker(dir: string, now = new Date()): Promise<string> {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const from = projectMarkerPath(dir);
  let to = `${from}.corrupt-${stamp}`;
  for (let n = 2; await exists(to); n++) to = `${from}.corrupt-${stamp}-${n}`;
  await fs.rename(from, to);
  return to;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}
