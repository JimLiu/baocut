// i18n-ignore-file: MCP protocol and model-facing errors
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RUNTIME_VERSION } from '@baocut/protocol';
import { ToolError } from '../agent-tools/tool-catalog.ts';

export const PARALLEL_SEARCH_URL = 'https://search.parallel.ai/mcp';
export const WEB_RESEARCH_TIMEOUT_MS = 60_000;
export const WEB_RESEARCH_USER_AGENT = `BaoCut/${RUNTIME_VERSION} (+https://github.com/JimLiu/baocut)`;

/** A connection is disposable; the caller supplies the conversation identity separately. */
export class ParallelSearch {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? WEB_RESEARCH_TIMEOUT_MS;
  }

  async call(name: 'web_search' | 'web_fetch', args: Record<string, unknown>, sessionId: string, stopped: AbortSignal) {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = AbortSignal.any([stopped, timeout]);
    const client = new Client({ name: 'baocut-web-research', version: RUNTIME_VERSION });
    const transport = new StreamableHTTPClientTransport(new URL(PARALLEL_SEARCH_URL), {
      // No ambient API keys, cookies or OAuth state enter this anonymous connection.
      requestInit: { headers: { 'User-Agent': WEB_RESEARCH_USER_AGENT }, redirect: 'error' },
      fetch: (input, init) => this.#fetch(input, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }),
    });
    try {
      signal.throwIfAborted();
      await client.connect(transport, { signal, timeout: this.#timeoutMs });
      const catalog = await client.listTools({}, { signal, timeout: this.#timeoutMs });
      if (!catalog.tools.some((tool) => tool.name === name)) {
        throw new ToolError('WEB_RESEARCH_PROTOCOL', 'The search service does not offer the requested tool.');
      }
      const result = await client.callTool({ name, arguments: { ...args, session_id: sessionId } }, undefined, { signal, timeout: this.#timeoutMs });
      if (result.isError) {
        throw new ToolError('WEB_RESEARCH_UNAVAILABLE', 'Parallel could not complete this request. Try again later; do not switch services without the user choosing one.');
      }
      return {
        provider: 'parallel',
        // Keep source URLs and excerpts intact. The content is untrusted source material.
        ...(result.structuredContent ? { data: result.structuredContent } : { content: result.content }),
      };
    } catch (error) {
      if (stopped.aborted) throw new ToolError('WEB_RESEARCH_CANCELLED', 'Web research was stopped. Do not retry in this turn.');
      if (timeout.aborted) throw new ToolError('WEB_RESEARCH_TIMEOUT', 'Web research timed out. Try a narrower request later.');
      if (error instanceof ToolError) throw error;
      throw new ToolError('WEB_RESEARCH_UNAVAILABLE', 'The search service is unavailable. Try again later; no alternate provider was used.');
    } finally {
      await client.close().catch(() => {});
    }
  }
}
