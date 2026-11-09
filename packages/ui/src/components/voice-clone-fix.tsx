import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LibraryEntrySummary } from '@baocut/protocol';
import { AlertDialog, Button, DialogContainer, ProgressCircle, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { libraryVoiceKey, type SpeechOption, type VoiceKey } from '../model/tools-tts.ts';
import { cloneFixLabel, declareCopy, libraryVoiceStatus, type CloneActivity, type CloneFix } from '../model/voice-picker.ts';
import { formFromEntry, rpcErrorText, uploadNotice, type VoiceEntry } from '../model/voices-library.ts';
import { useRuntime } from '../runtime/context.tsx';
import { useJobs } from '../state/jobs-store.ts';
import { useShell } from '../state/shell-store.ts';
import { useVoiceClones } from '../state/voice-clone-store.ts';
import { useVoiceHandoff } from '../state/voice-handoff-store.ts';
import { loadVoice, saveVoice, uploadClone } from './models/voice-actions.ts';
import { MY_VOICES_COPY as COPY } from './models/voices-copy.ts';

/**
 * 音色选择器里选了我的声音里一只、还没在这家云端建好时去补那一步（设计稿 voice-picker.jsx `fixVoiceClone`）：
 * `upload` 先告知（传什么、传给谁）再上传，进度在控件下那一行；`declare` 就地补一句本人声明（写进音色），接着走下一步；
 * `authorize` 带着回程去我的声音补录授权声明（存好就上传）；`diagnose` 带着回程去我的声音看没建成的原因与一键办法。
 * 去我的声音之前那一处已经选上了这只；回来后由它认领回程（`useHandoffClaim`）。浏览器里读不到我的声音，这里走不到。
 */

type FixOption = Pick<SpeechOption, 'providerId' | 'provider' | 'modelId' | 'info' | 'voiceClone'>;

/** 这次运行里的克隆进展：克隆任务与界面发起的上传，变了就重算现状。 */
export function useCloneActivity(): CloneActivity {
  const jobs = useJobs((s) => s.jobs);
  const attempts = useVoiceClones((s) => s.attempts);
  return useMemo(() => ({ jobs, attempts }), [jobs, attempts]);
}

type Ask =
  | { kind: 'upload'; voice: LibraryEntrySummary; option: FixOption; entry: VoiceEntry | null }
  | { kind: 'declare'; voice: LibraryEntrySummary; option: FixOption };

/**
 * `key` 是这一处的身份（`pick:<哪一处>`，回程认领用），`from` 是回程条上写的来处（面板名）。返回 `run` 与要挂在这一处的确认框。
 */
export function useCloneFix({ key, from }: { key: string; from: string }): {
  run: (voice: LibraryEntrySummary, option: FixOption, fix: CloneFix) => void;
  dialog: ReactNode;
} {
  const runtime = useRuntime();
  const route = useShell((s) => s.route);
  const go = useShell((s) => s.go);
  const setHandoff = useVoiceHandoff((s) => s.setHandoff);
  const [ask, setAsk] = useState<Ask | null>(null);

  const away = (option: FixOption, extra: { voiceId?: string; task?: { kind: 'consent'; voiceId: string }; open?: 'task' }) => {
    setHandoff({ key, from, route, target: { kind: 'cloud', id: option.providerId }, ...extra });
    go({ tab: 'models', category: 'tts', page: 'voices' });
  };

  const run = (voice: LibraryEntrySummary, option: FixOption, fix: CloneFix) => {
    switch (fix) {
      case 'upload':
        // 告知里写参考录音多大：读到条目再开，读不到就不写大小。
        void loadVoice(runtime, voice.id)
          .catch(() => null)
          .then((entry) => setAsk({ kind: 'upload', voice, option, entry }));
        return;
      case 'declare':
        setAsk({ kind: 'declare', voice, option });
        return;
      case 'authorize':
        away(option, { task: { kind: 'consent', voiceId: voice.id }, open: 'task' });
        return;
      case 'diagnose':
        away(option, { voiceId: voice.id });
        return;
      case 'wait':
        return;
    }
  };

  const upload = async (voice: LibraryEntrySummary, option: FixOption) => {
    if (await uploadClone(runtime, voice.id, option.providerId)) ToastQueue.neutral(COPY.cloneStarted(option.provider), { timeout: 4000 });
    else ToastQueue.negative(COPY.cloneRejected(option.provider), { timeout: 8000 });
  };

  const declare = async (voice: LibraryEntrySummary, option: FixOption) => {
    try {
      const entry = await loadVoice(runtime, voice.id);
      const outcome = await saveVoice(runtime, { ...formFromEntry(entry), consent: true }, entry);
      if (outcome.kind === 'conflict') {
        ToastQueue.negative(declareCopy.failed(outcome.message), { timeout: 8000 });
        return;
      }
      // 补上声明后接着走下一步（多半是上传；要授权声明录音而没有时去补录）。
      const next = { ...voice, consentDeclared: true };
      const st = libraryVoiceStatus(next, option, { jobs: useJobs.getState().jobs, attempts: useVoiceClones.getState().attempts });
      if (st.fix && st.fix !== 'declare') run(next, option, st.fix);
    } catch (error) {
      ToastQueue.negative(declareCopy.failed(rpcErrorText(error)), { timeout: 8000 });
    }
  };

  const dialog = (
    <DialogContainer onDismiss={() => setAsk(null)}>
      {ask?.kind === 'upload' ? (
        <AlertDialog
          variant="confirmation"
          title={COPY.uploadTitle(ask.option.provider)}
          primaryActionLabel={COPY.upload}
          cancelLabel={COPY.cancel}
          onPrimaryAction={() => void upload(ask.voice, ask.option)}>
          {uploadNotice(ask.voice, ask.option.provider, ask.entry)}
        </AlertDialog>
      ) : ask?.kind === 'declare' ? (
        <AlertDialog
          variant="confirmation"
          title={declareCopy.title(ask.voice.name)}
          primaryActionLabel={declareCopy.confirm}
          cancelLabel={declareCopy.cancel}
          onPrimaryAction={() => void declare(ask.voice, ask.option)}>
          {declareCopy.body(ask.option.provider)}
        </AlertDialog>
      ) : null}
    </DialogContainer>
  );
  return { run, dialog };
}

const lineRow = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 4, minWidth: 0 });
const lineText = style({ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 160 });

/**
 * 控件下那一句（设计稿 `VoiceLine`）：选中的我的声音还没在这家建好、补得上时后面跟一个补那一步的按钮，在传时前面转圈。
 * `className` 是这一处原来那一句的样式（字号与颜色）。
 */
export function VoiceFixLine({
  line,
  fix,
  provider,
  className,
  inline = false,
  onFix,
}: {
  line: string;
  fix: CloneFix | null;
  provider: string;
  className: string;
  /** 原来那一句是 `span`（工具页那一列里）。 */
  inline?: boolean;
  onFix: () => void;
}) {
  if (!fix) return inline ? <span className={className}>{line}</span> : <p className={className}>{line}</p>;
  return (
    <div className={`${className} ${lineRow}`} role={fix === 'wait' ? 'status' : undefined}>
      {fix === 'wait' ? <ProgressCircle size="S" isIndeterminate aria-label={line} /> : null}
      <span className={lineText}>{line}</span>
      {fix !== 'wait' ? (
        <Button variant="secondary" size="S" onPress={onFix}>
          {cloneFixLabel(fix, provider)}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * 回程认领：这一处（`key`）送去我的声音补那一步、回来时清掉回程，那只音色交给 `onClaim` 选上（面板与工具页的草稿本来就还在，
 * 配音页的默认音色是那一页自己的状态，要靠它）。只在挂上时看一次：送走时这一处还挂着，那时不能认领；回来是重新挂上
 * （换页签时页面卸掉）。
 */
export function useHandoffClaim(key: string, onClaim: (voice: VoiceKey) => void): void {
  const claim = useRef(onClaim);
  claim.current = onClaim;
  useEffect(() => {
    const { handoff, setHandoff } = useVoiceHandoff.getState();
    if (handoff?.key !== key) return;
    const id = handoff.voiceId ?? handoff.task?.voiceId;
    if (id) claim.current(libraryVoiceKey(id));
    setHandoff(null);
  }, [key]);
}
