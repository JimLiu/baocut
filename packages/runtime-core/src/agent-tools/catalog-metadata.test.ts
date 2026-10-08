import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MCP_SERVICE_TOOL_NAMES, TOOL_EFFECTS, TOOL_SURFACES } from '@baocut/protocol';
import { serviceToolExposed } from '../services/mcp-tools.ts';
import type { ToolInfo } from './tool-catalog.ts';
import { allToolSets } from './all-tool-sets.ts';

/**
 * 工具目录项的一致性（架构设计 §3.5，Agent 面设计 §2.2、§2.3）：三个面（工具桥、MCP 服务、CLI）都按目录项派生，
 * 这里断言每一项都写全了，示例能通过自己的 schema，MCP 服务的开放清单与协议常量一致。
 */

interface Entry {
  name: string;
  info: ToolInfo;
  schema: z.ZodType;
  json: { properties?: Record<string, Record<string, unknown>>; required?: string[] };
}

const entries: Entry[] = allToolSets().flatMap((set) =>
  Object.keys(set.schemas).map((name) => ({
    name,
    info: set.definitions[name]!,
    schema: set.schemas[name]!,
    json: z.toJSONSchema(set.schemas[name]!, { io: 'input' }) as Entry['json'],
  })),
);

/** 字段 JSON Schema 里的枚举值：直接的 enum、数组元素的 enum、联合里的 enum。 */
function enumValues(prop: Record<string, unknown>): unknown[] {
  const values: unknown[] = [];
  const visit = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.enum)) values.push(...n.enum);
    if (n.items) visit(n.items);
    for (const branch of [...((n.anyOf as unknown[]) ?? []), ...((n.oneOf as unknown[]) ?? [])]) visit(branch);
  };
  visit(prop);
  return values;
}

describe('工具目录项', () => {
  it('没有重名的工具', () => {
    const names = entries.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const { name, info, schema, json } of entries) {
    describe(name, () => {
      it('effect、surfaces 写全，effect 与 annotations 一致', () => {
        expect(TOOL_EFFECTS).toContain(info.effect);
        expect(info.surfaces.length).toBeGreaterThan(0);
        expect(new Set(info.surfaces).size).toBe(info.surfaces.length);
        for (const surface of info.surfaces) expect(TOOL_SURFACES).toContain(surface);
        // query ⇔ readOnlyHint；destructive ⇒ destructiveHint。
        expect(info.annotations?.readOnlyHint === true).toBe(info.effect === 'query');
        if (info.effect === 'destructive') expect(info.annotations?.destructiveHint).toBe(true);
      });

      it('description 第一句是一行摘要', () => {
        const first = info.description.split('\n')[0]!;
        const end = first.indexOf('。');
        expect(end, `「${first}」没有以句号结束的第一句`).toBeGreaterThan(0);
        expect([...first.slice(0, end + 1)].length).toBeLessThanOrEqual(80);
        expect(info.title.trim()).not.toBe('');
      });

      it('每个字段有 description，枚举值都写进说明', () => {
        for (const [field, prop] of Object.entries(json.properties ?? {})) {
          const text = prop.description;
          expect(typeof text === 'string' && text.length > 0, `${name}.${field} 没有 description`).toBe(true);
          for (const value of enumValues(prop)) {
            expect(text as string, `${name}.${field} 的说明没有列出 ${String(value)}`).toContain(String(value));
          }
        }
      });

      it('examples 有一到三个，每个都通过 schema', () => {
        expect(info.examples.length).toBeGreaterThanOrEqual(1);
        expect(info.examples.length).toBeLessThanOrEqual(3);
        for (const example of info.examples) {
          expect(example.title.trim()).not.toBe('');
          const parsed = schema.safeParse(example.args);
          expect(parsed.success, `${name} 的示例「${example.title}」：${parsed.error?.message ?? ''}`).toBe(true);
        }
      });

      it('positional 指向 schema 里的字段', () => {
        if (info.positional === undefined) return;
        expect(Object.keys(json.properties ?? {})).toContain(info.positional);
      });
    });
  }
});

describe('MCP 服务的开放清单', () => {
  const sorted = <T extends { name: string }>(list: readonly T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));

  it('由目录的 surfaces 推出，与协议常量 MCP_SERVICE_TOOL_NAMES 一致（名字、标题、效果）', () => {
    const derived = entries
      .filter((e) => serviceToolExposed(e.info, 'auto'))
      .map((e) => ({ name: e.name, title: e.info.title, effect: e.info.effect }));
    expect(sorted(derived)).toEqual(sorted(MCP_SERVICE_TOOL_NAMES));
  });

  it('read 等级只露只读的工具；ask 与 auto 露出全部 mcp 面的工具', () => {
    const exposed = (level: 'read' | 'ask' | 'auto') =>
      entries
        .filter((e) => serviceToolExposed(e.info, level))
        .map((e) => e.name)
        .sort();
    expect(exposed('read')).toEqual(
      MCP_SERVICE_TOOL_NAMES.filter((t) => t.effect === 'query')
        .map((t) => t.name)
        .sort(),
    );
    expect(exposed('ask')).toEqual(exposed('auto'));
  });
});
