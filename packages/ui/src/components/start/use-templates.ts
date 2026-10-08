import { useCallback, useEffect, useState } from 'react';
import type { HomeTemplate } from '../../model/home-templates.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { forgetTemplateFile, loadTemplates, templateFileUrl, templatePrompt } from '../../runtime/template-commands.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useTemplateCatalog, type TemplateCatalogStore } from '../../state/template-catalog-store.ts';

/**
 * 模板目录：挂上时、`refresh` 变了时（弹窗打开）、重新连上时各取一次。没连上时不发，等连上再取。
 * 返回目录的镜像与一个「重试」。
 */
export function useTemplateCatalogLoader(refresh: unknown = null): TemplateCatalogStore & { retry(): void } {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const catalog = useTemplateCatalog();
  useEffect(() => {
    if (connected) void loadTemplates(runtime);
  }, [runtime, connected, refresh]);
  const retry = useCallback(() => void loadTemplates(runtime), [runtime]);
  return { ...catalog, retry };
}

export type PromptState = { state: 'loading' } | { state: 'ready'; text: string } | { state: 'failed'; message: string };

/** 一个模板的提示词（`templates.get`）：按「id@版本」缓存，换模板时先显示加载中。 */
export function useTemplatePrompt(template: Pick<HomeTemplate, 'id' | 'version'> | null): PromptState & { retry(): void } {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const key = template ? `${template.id}@${template.version}` : '';
  const [state, setState] = useState<{ key: string; value: PromptState }>({ key, value: { state: 'loading' } });
  const [attempt, setAttempt] = useState(0);
  const current = state.key === key ? state.value : ({ state: 'loading' } as const);

  useEffect(() => {
    if (!template || !connected) return undefined;
    let cancelled = false;
    templatePrompt(runtime, template.id, template.version).then(
      (text) => !cancelled && setState({ key, value: { state: 'ready', text } }),
      (error: Error) => !cancelled && setState({ key, value: { state: 'failed', message: error.message } }),
    );
    return () => {
      cancelled = true;
    };
    // template 只经 key 生效：同一 id@版本 不重取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, key, connected, attempt]);

  const retry = useCallback(() => {
    setState({ key, value: { state: 'loading' } });
    setAttempt((n) => n + 1);
  }, [key]);
  return { ...current, retry };
}

/**
 * 模板随附文件（封面图、预览视频）的地址；`path` 为 null 时不取。媒体元素报错时调 `fail`：丢掉句柄重取一次，
 * 再错就放弃（调用方退回占位封面）。
 */
export function useTemplateFileUrl(id: string, path: string | null): { url: string | null; failed: boolean; fail(): void } {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const key = path ? `${id}:${path}` : '';
  const [state, setState] = useState<{ key: string; url: string | null; failures: number }>({ key, url: null, failures: 0 });
  const current = state.key === key ? state : { key, url: null, failures: 0 };

  useEffect(() => {
    if (!path || !connected || current.failures > 1) return undefined;
    let cancelled = false;
    templateFileUrl(runtime, id, path).then(
      (url) => !cancelled && setState((s) => ({ key, url, failures: s.key === key ? s.failures : 0 })),
      () => !cancelled && setState((s) => ({ key, url: null, failures: (s.key === key ? s.failures : 0) + 2 })),
    );
    return () => {
      cancelled = true;
    };
  }, [runtime, id, path, key, connected, current.failures]);

  const fail = useCallback(() => {
    if (path) forgetTemplateFile(id, path);
    setState((s) => ({ key, url: null, failures: (s.key === key ? s.failures : 0) + 1 }));
  }, [id, path, key]);
  return { url: current.url, failed: current.failures > 1, fail };
}
