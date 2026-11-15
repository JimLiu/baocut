import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  helloResult,
  journalLine,
  RECORDING_WORKER_PROTOCOL,
  segmentResult,
  sourcesResult,
  startResult,
  stopResult,
  workerEvent,
  type KeyEventLine,
  type PointerEventLine,
  type WorkerStartParams,
} from './worker-protocol.ts';

// The Rust side reads the same file (crates/recording-worker/tests/protocol_fixture.rs).
const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../crates/recording-worker/tests/fixtures/protocol.json',
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;

function items(name: string): unknown[] {
  const value = fixture[name];
  if (!Array.isArray(value) || value.length === 0) throw new Error(`fixture has no ${name}`);
  return value;
}

describe('recording worker protocol fixture', () => {
  it('uses the same protocol version', () => {
    expect(fixture.protocol).toBe(RECORDING_WORKER_PROTOCOL);
  });

  const schemas: Array<[string, z.ZodType]> = [
    ['hello', helloResult],
    ['sources', sourcesResult],
    ['startResult', startResult],
    ['segmentResult', segmentResult],
    ['stopResult', stopResult],
    ['events', workerEvent],
    ['journal', journalLine],
  ];
  it.each(schemas)('parses every %s sample without loss', (name, schema) => {
    for (const item of items(name)) {
      expect(schema.parse(item)).toEqual(item);
    }
  });

  it('keeps start params and event rows in the documented shapes', () => {
    const start = items('start') as WorkerStartParams[];
    expect(start.map((params) => params.source.kind).sort()).toEqual(['area', 'display', 'display', 'window']);
    const pointer = items('pointerEvents') as PointerEventLine[];
    expect(pointer.map((row) => row[1])).toEqual(['m', 'b', 'c']);
    const keys = items('keyEvents') as KeyEventLine[];
    for (const row of keys) {
      expect(row).toHaveLength(4);
      expect(row[0]).toMatch(/^\d+$/);
    }
  });
});
