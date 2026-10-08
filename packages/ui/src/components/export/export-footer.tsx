import type { ExportSettings } from '@baocut/protocol';
import { Button } from '@react-spectrum/s2';
import { EXPORT_COPY } from './export-copy.ts';
import { Actions, Note } from './export-parts.tsx';
import { RejectedAlert } from './export-remedy.tsx';
import type { ExportEnv, ExportSubmit } from './use-export-submit.ts';

/**
 * 每页底部（设计稿 export.jsx 的 `.xacts`）：上一次提交被拒的原因与补救，视频没追平时的一句说明，取消与导出按钮。
 * `settings` 为 null 时这页现在导不了（没勾内容、范围为空……），导出按钮置灰，原因由各页自己写在上面。
 */
export function SubmitFoot({
  env,
  submitter,
  settings,
  label,
  onClose,
  onSubmit,
}: {
  env: ExportEnv;
  submitter: ExportSubmit;
  settings: ExportSettings | null;
  label: string;
  onClose: () => void;
  /** 导出按钮另有提交方式（音频页「每种一份」一次提交几份）；不给时提交 `settings`。 */
  onSubmit?: () => void;
}) {
  return (
    <>
      <RejectedAlert problem={submitter.problem} settings={submitter.rejected} videoId={env.videoId} busy={submitter.busy} onSubmit={(s, dir) => void submitter.submit(s, dir)} />
      {!env.ready ? <Note warn>{EXPORT_COPY.notOpen}</Note> : null}
      <Actions>
        <Button variant="secondary" fillStyle="outline" onPress={onClose}>
          {EXPORT_COPY.cancel}
        </Button>
        <Button
          variant="accent"
          isPending={submitter.busy}
          isDisabled={!env.ready || !settings}
          onPress={() => settings && (onSubmit ? onSubmit() : void submitter.submit(settings))}>
          {label}
        </Button>
      </Actions>
    </>
  );
}
