import { ProviderFailure, type TextCallHooks, type TextProvider, type TextReply, type TextRun } from '@baocut/models';
import type { AdapterConfig, AdapterHttp, TextAdapter } from './adapter.ts';
import { ProviderAborted, redact } from './http/provider-fetch.ts';
import type { CallReporter } from './usage-reporter.ts';
import { ProvidersConfig as PC } from '@baocut/protocol/messages/providers';

export interface OnlineTextProviderOptions {
  providerId: string;
  label: () => string;
  adapter: TextAdapter;
  /** 执行时的配置（含从凭据存储取出的密钥）；没有启用或没有密钥时 null，凭据存储不可用时抛 `ProviderFailure`。 */
  config: () => Promise<AdapterConfig | null>;
  http?: AdapterHttp;
  /** 调用结束时的报告（用量账本与账号状态，§6.10）。 */
  report?: CallReporter;
}

/**
 * 在线 Provider 的文本执行者（架构设计 §6.4）：执行时再读一次配置，按冻结的模型与参数发一次请求（HTTP 层自己有界重试），
 * 把响应读成 `TextReply`。并发上限、计数与结果检查在 `TextRunner` 里，任务与进程内调用共用。
 */
export class OnlineTextProvider implements TextProvider {
  readonly id: string;
  readonly #options: OnlineTextProviderOptions;

  constructor(options: OnlineTextProviderOptions) {
    this.#options = options;
    this.id = options.providerId;
  }

  async generateText(run: TextRun, signal: AbortSignal, hooks: TextCallHooks): Promise<TextReply> {
    const label = this.#options.label();
    let secret: string | null = null;
    // 请求发出时记下（用量账本只记真的发出了请求的调用）。
    let sent: { accountId: string | null; startedAt: number } | null = null;
    const report = (outcome: { reply?: TextReply; error?: unknown }) => {
      if (!sent || !this.#options.report) return;
      const usage = outcome.reply?.usage;
      this.#options.report({
        capability: 'generateText',
        modelId: run.modelId,
        source: run.source ?? 'inline',
        ...(run.ref ? { ref: run.ref } : {}),
        accountId: sent.accountId,
        startedAt: sent.startedAt,
        units: {
          ...(typeof usage?.inputTokens === 'number' ? { inputTokens: usage.inputTokens } : {}),
          ...(typeof usage?.outputTokens === 'number' ? { outputTokens: usage.outputTokens } : {}),
          ...(typeof usage?.cachedTokens === 'number' ? { cachedTokens: usage.cachedTokens } : {}),
        },
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      });
    };
    try {
      const config = await this.#options.config();
      if (!config) throw new ProviderFailure('unavailable', PC.notEnabledOrNoKey({ label }).text, { providerId: this.id });
      secret = config.credential;
      const adapter = this.#options.adapter;
      const model = adapter.models(config).find((m) => m.modelId === run.modelId);
      if (!model) throw new ProviderFailure('unavailable', PC.noTextModel({ label, model: run.modelId }).text, { providerId: this.id });
      sent = { accountId: config.accountId ?? null, startedAt: Date.now() };
      const reply = await adapter.generate({
        config,
        model,
        parameters: run.parameters,
        signal,
        http: this.#options.http ?? {},
        onRetry: () => hooks.retry(),
      });
      report({ reply });
      return reply;
    } catch (error) {
      if (error instanceof ProviderAborted) throw error;
      if (error instanceof ProviderFailure) {
        if (!signal.aborted) report({ error });
        throw error;
      }
      if (signal.aborted) throw new ProviderAborted();
      // 意料之外的错误：文本可能来自供应商的响应，去掉密钥再报告。
      const message = error instanceof Error ? error.message : String(error);
      const failure = new ProviderFailure('protocol', redact(PC.textFailed({ label, message }).text, secret ? [secret] : []));
      report({ error: failure });
      throw failure;
    }
  }
}
