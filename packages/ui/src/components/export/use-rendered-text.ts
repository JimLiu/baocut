import { useEffect, useState } from 'react';
import type { ExportSettings, RenderedTextOutput, TextExportSettings } from '@baocut/protocol';
import { explainExportError, type ExportProblem } from '../../model/export-rejection.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { ExportEnv } from './use-export-submit.ts';

/** 改设置之后等这么久再去排：连着点几个开关只排最后一次。 */
const DEBOUNCE_MS = 150;

export interface RenderedText {
  /** 与当前设置对应的正文；还没排好、被拒或没有设置时 null。 */
  output: RenderedTextOutput | null;
  /** 上一次排好的正文（设置刚改、新的还没回来时先留着它，预览不闪）。 */
  shown: RenderedTextOutput | null;
  loading: boolean;
  problem: ExportProblem | null;
}

/**
 * 按导出设置取字幕或文稿的正文（`exports.renderText`，不写文件）：与同样设置导出的文件逐字节相同。
 * 设置、序列或文档换了版本时重排；晚到的旧结果丢掉。`documentIds` 是正文取自的文档，它们的版本进重排的依据。
 */
export function useRenderedText(env: ExportEnv, settings: ExportSettings | null, documentIds: readonly string[]): RenderedText {
  const runtime = useRuntime();
  const versions = documentIds.map((id) => env.documents[id]?.currentRevision ?? '').join(',');
  const key = settings && env.ready ? JSON.stringify([env.videoId, settings, env.sequence.revision, versions]) : null;
  const [state, setState] = useState<{ key: string | null; output: RenderedTextOutput | null; problem: ExportProblem | null }>({
    key: null,
    output: null,
    problem: null,
  });
  const [shown, setShown] = useState<RenderedTextOutput | null>(null);

  useEffect(() => {
    if (!key || !settings) return;
    let live = true;
    const timer = setTimeout(() => {
      runtime.renderTextExport({ videoId: env.videoId, settings: settings as TextExportSettings }).then(
        (result) => {
          if (!live) return;
          const output = result.outputs[0] ?? null;
          setState({ key, output, problem: null });
          setShown(output);
        },
        (error: unknown) => {
          if (!live) return;
          setState({
            key,
            output: null,
            problem: explainExportError(error, { kind: settings.kind, stage: 'rejected', documents: env.documents }),
          });
          setShown(null);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` 已经包含了设置与版本；`settings`、`env.documents` 每次渲染都是新对象，不进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, key]);

  const fresh = key !== null && state.key === key;
  return {
    output: fresh ? state.output : null,
    shown: key ? (fresh ? state.output : shown) : null,
    loading: key !== null && !fresh,
    problem: fresh ? state.problem : null,
  };
}
