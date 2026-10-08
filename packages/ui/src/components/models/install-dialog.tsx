import { useEffect, useState } from 'react';
import type { ModelInstallPlan, ModelLicense } from '@baocut/protocol';
import { Button, ButtonGroup, Content, Dialog, DialogContainer, Heading, ProgressCircle, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { CHECK_LABEL } from '../../model/model-check-copy.ts';
import { installPlanView, problemText, rpcProblem } from '../../model/models-install.ts';
import { licenseBrief, nonCommercial } from '../../model/models-tts-local.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { confirmInstall, planInstall, type InstallMode } from './local-model-actions.ts';
import { LOCAL_INSTALL_COPY as COPY } from './local-models-copy.ts';
import { TTS_LOCAL_COPY as TTS } from './tts-local-copy.ts';

const stack = style({ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 });
const waiting = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-sm', color: 'gray-700' });
const lead = style({ margin: 0, font: 'body', fontWeight: 'bold', color: 'gray-900' });
const text = style({ margin: 0, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const note = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const problem = style({ margin: 0, font: 'ui-sm', color: 'negative-900', overflowWrap: 'anywhere' });
const lines = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  margin: 0,
  padding: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
});
const line = style({ display: 'flex', justifyContent: 'space-between', gap: 12, font: 'ui-xs', color: 'gray-800' });
const lineLabel = style({ overflowWrap: 'anywhere', minWidth: 0 });
const lineValue = style({ flexShrink: 0, color: 'gray-600' });
const licenseBox = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'notice-subtle',
  color: 'gray-900',
});
const licenseHead = style({ margin: 0, font: 'ui-sm', fontWeight: 'bold' });

type Phase =
  | { kind: 'planning' }
  | { kind: 'plan'; plan: ModelInstallPlan; replanned: boolean }
  | { kind: 'failed'; message: string };

/**
 * 下载 / 补齐 / 修复的确认（架构设计 §6.3 的两步）：打开时只要计划（不下载），给人看要下载多少、续传多少、磁盘还剩多少、从哪儿下；
 * 确认时把 `confirmBytes` 原样交回去。大小变了时换成新计划再问一次，不关对话框。磁盘明显不够时不让确认。
 * 不许商用的模型（设计稿 panel-tts-local.jsx `withModelLicense`）下载前先写清许可，确认按钮写「我知道了，下载」；补齐与修复不再问
 * （权重已在，设计稿 settings-local.jsx）。补齐只下载缺的组件，先说一句装好的不动。
 * 修复（设计稿 settings-local.jsx 的修复确认）写明修好后会自动再检查一次；文件都完好时给「重新检查」。
 * 状态放在 Dialog 外层：S2 的 Dialog 会把 children 在几个 slot 里各渲染一遍。
 */
export function InstallDialog({
  bundleId,
  name = bundleId,
  license = null,
  licenseUse = TTS.licenseUse,
  mode,
  note,
  onClose,
  onStarted,
  onRecheck,
}: {
  bundleId: string;
  /** 标题与提示里的名字，默认是模型包 ID。 */
  name?: string;
  license?: ModelLicense | null;
  /** 不许商用时那一句「用它做出的东西也只能……」，默认是语音合成的说法。 */
  licenseUse?: string;
  mode: InstallMode;
  /** 补齐时换掉默认那一句（从公共组件那一行借这只模型补齐时，说清只补它缺的）。 */
  note?: string;
  onClose: () => void;
  /** 提交了任务（修复时由行记下，修完自动检查；给了它就不再弹「开始下载」）。 */
  onStarted?: (jobId: string) => void;
  /** 修复时文件都完好：给「重新检查」。 */
  onRecheck?: () => void;
}) {
  const runtime = useRuntime();
  const [phase, setPhase] = useState<Phase>({ kind: 'planning' });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    planInstall(runtime, mode, bundleId).then(
      (result) => live && setPhase({ kind: 'plan', plan: result.plan, replanned: false }),
      (error: unknown) => live && setPhase({ kind: 'failed', message: problemText(rpcProblem(error)) }),
    );
    return () => {
      live = false;
    };
  }, [runtime, mode, bundleId]);

  const plan = phase.kind === 'plan' ? phase.plan : null;
  const view = plan ? installPlanView(plan) : null;
  const canConfirm = !!view && !view.upToDate && !view.noSpace && !busy;

  const submit = async (close: () => void) => {
    if (!plan || !canConfirm) return;
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await confirmInstall(runtime, mode, plan);
      if (outcome.kind === 'started') {
        if (onStarted) onStarted(outcome.jobId);
        else ToastQueue.neutral(COPY.started(name), { timeout: 4000 });
        close();
      } else setPhase({ kind: 'plan', plan: outcome.plan, replanned: outcome.kind === 'replan' });
    } catch (error) {
      setFailure(problemText(rpcProblem(error)));
    } finally {
      setBusy(false);
    }
  };

  const size = view?.amount ?? '';
  const restricted = mode === 'install' ? nonCommercial(license) : null;
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        {({ close }) => (
          <>
            <Heading slot="title">
              {mode === 'repair' ? COPY.repairTitle(name) : mode === 'complete' ? COPY.completeTitle(name) : COPY.installTitle(name)}
            </Heading>
            <Content>
              <div className={stack}>
                {phase.kind === 'planning' ? (
                  <div className={waiting}>
                    <ProgressCircle size="S" isIndeterminate aria-label={COPY.planning} />
                    <span>{mode === 'repair' ? COPY.verifying : COPY.planning}</span>
                  </div>
                ) : null}
                {phase.kind === 'failed' ? (
                  <>
                    <p className={lead}>{COPY.planFailed}</p>
                    <p className={problem}>{phase.message}</p>
                  </>
                ) : null}
                {view ? (
                  view.upToDate ? (
                    <p className={text}>{mode === 'repair' ? COPY.repairUpToDate : COPY.upToDate}</p>
                  ) : (
                    <>
                      {phase.kind === 'plan' && phase.replanned ? <p className={problem}>{COPY.replanned}</p> : null}
                      {mode === 'complete' ? <p className={text}>{note ?? COPY.completeNote}</p> : null}
                      <p className={lead}>{view.size}</p>
                      {view.resumed ? <p className={text}>{view.resumed}</p> : null}
                      {view.space ? <p className={text}>{view.space}</p> : null}
                      {view.noSpace ? <p className={problem}>{view.noSpace}</p> : null}
                      <ul className={lines} aria-label={COPY.details}>
                        {view.lines.map((l) => (
                          <li key={l.key} className={line}>
                            <span className={lineLabel}>{l.label}</span>
                            <span className={lineValue}>{l.value}</span>
                          </li>
                        ))}
                      </ul>
                      <p className={note}>{COPY.source(view.source)}</p>
                      {mode === 'repair' ? <p className={text}>{COPY.repairThenCheck}</p> : null}
                      {restricted ? (
                        <div className={licenseBox} role="note" aria-label={TTS.licenseTitle}>
                          <p className={licenseHead}>
                            {TTS.licenseTitle} · {name}
                          </p>
                          <p className={text}>{licenseBrief(restricted)}</p>
                          <p className={note}>{restricted.url}</p>
                          <p className={text}>{licenseUse}</p>
                        </div>
                      ) : null}
                    </>
                  )
                ) : null}
                {failure ? <p className={problem}>{failure}</p> : null}
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {view && !view.upToDate ? COPY.cancel : COPY.close}
              </Button>
              {view?.upToDate && mode === 'repair' && onRecheck ? (
                <Button
                  variant="accent"
                  onPress={() => {
                    close();
                    onRecheck();
                  }}>
                  {CHECK_LABEL.recheck}
                </Button>
              ) : null}
              {view && !view.upToDate ? (
                <Button variant="accent" isPending={busy} isDisabled={!canConfirm} onPress={() => void submit(close)}>
                  {mode === 'repair' ? COPY.confirmRepair : restricted ? TTS.licenseConfirm(size) : COPY.confirmInstall(size)}
                </Button>
              ) : null}
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
