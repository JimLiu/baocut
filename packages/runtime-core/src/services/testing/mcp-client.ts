import http from 'node:http';

/**
 * 测试用的外部 MCP 客户端：用原始 HTTP 请求，`Host`、`Origin` 与 `Authorization` 都由测试决定（fetch 不让改 `Host`）。
 */

export interface RawResponse {
  status: number;
  body: string;
}

export function raw(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<RawResponse> {
  const target = new URL(url);
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: options.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(payload !== undefined ? { 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

let rpcId = 0;

/** 以一个客户端令牌调用 MCP 方法。 */
export async function rpc(
  url: string,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; result?: Record<string, unknown>; error?: { code: number; message: string } }> {
  const response = await raw(url, { headers: { Authorization: `Bearer ${token}` }, body: { jsonrpc: '2.0', id: ++rpcId, method, params } });
  if (response.status !== 200) return { status: response.status };
  return { status: 200, ...(JSON.parse(response.body) as object) };
}

/** 工具结果的形态随工具而变，测试里按需取字段。 */
export type Loose = any;

/** 调用一个工具：结果的 JSON 正文与是否出错。 */
export async function call(
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; body: Loose }> {
  const response = await rpc(url, token, 'tools/call', { name, arguments: args });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const content = response.result!.content as { type: string; text: string }[];
  return { isError: Boolean(response.result!.isError), body: JSON.parse(content[0]!.text) };
}
