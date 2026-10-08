import { z } from 'zod';
import { refOf, type Localized, type MessageRef } from './message-ref.ts';
import { ProtocolValidation as V } from './messages/protocol/protocol-validation.ts';

/**
 * 结构化输出的 JSON Schema（`models.generateText` 的 `responseFormat.schema`，架构设计 §6.4）：提交时编译一次，
 * 不合法的 schema 在提交时拒绝；模型的输出在返回之前按它校验。单独的子路径导出，界面打包不带上 zod。
 *
 * 支持 zod `fromJSONSchema` 认得的那部分（type、properties、required、additionalProperties、items、enum、const、
 * anyOf/oneOf/allOf、长度与范围、pattern、format、本地 `$ref`）；外部 `$ref` 与认不出的 `type` 是不合法的 schema。
 * 根必须是 `type: 'object'`：各供应商的结构化输出都以对象为根。
 */

/** schema 的规范 JSON 至多这么长（字节）。 */
export const MAX_JSON_SCHEMA_BYTES = 100_000;

export class JsonSchemaError extends Error {
  /** 说明的消息引用，供按读者语言重新显示。 */
  readonly messageRef?: MessageRef;
  constructor(message: string | Localized) {
    super(String(message));
    this.name = 'JsonSchemaError';
    if (typeof message !== 'string') this.messageRef = refOf(message);
  }
}

export interface CompiledJsonSchema {
  /** 不合的地方（`路径：说明`），至多 20 条；合格时为空。 */
  validate(value: unknown): string[];
}

export function compileJsonSchema(schema: unknown): CompiledJsonSchema {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) throw new JsonSchemaError(V.jsonSchemaNotObject());
  if (new TextEncoder().encode(JSON.stringify(schema)).length > MAX_JSON_SCHEMA_BYTES) {
    throw new JsonSchemaError(V.jsonSchemaTooLarge({ max: MAX_JSON_SCHEMA_BYTES }));
  }
  if ((schema as { type?: unknown }).type !== 'object') throw new JsonSchemaError(V.jsonSchemaRootType());
  let compiled: z.ZodType;
  try {
    compiled = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  } catch (error) {
    throw new JsonSchemaError(V.jsonSchemaInvalid({ error: error instanceof Error ? error.message : String(error) }));
  }
  return {
    validate(value) {
      const result = compiled.safeParse(value);
      if (result.success) return [];
      return result.error.issues
        .slice(0, 20)
        .map((issue) =>
          V.jsonSchemaIssue({ path: issue.path.length > 0 ? issue.path.join('.') : V.jsonSchemaRoot().text, message: issue.message }).text,
        );
    },
  };
}
