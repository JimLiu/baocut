import { useEffect, useState } from 'react';
import type { ModelInfoBase, OnlineCapability, SpeechModelInfo } from '@baocut/protocol';
import { Badge, Button, ButtonGroup, Content, Dialog, DialogContainer, Heading, TextField } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  outputFacts,
  PROBE_IMAGE_PROMPT,
  probeSpeechText,
  PROBE_TEXT_PROMPT,
  probeNeedsVoice,
  probeVoice,
  textProbeFacts,
  type ProbeState,
} from '../../model/models-probe.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { probeMediaUrl } from './model-actions.ts';
import { M as MANAGEMENT } from './model-management-copy.ts';
import { PROBE_COPY } from './models-copy.ts';

const stack = style({ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 });
const head = style({ display: 'flex', alignItems: 'center', gap: 8 });
const provider = style({ font: 'title-sm', color: 'gray-900' });
const modelId = style({ font: 'code-sm', color: 'gray-700', overflowWrap: 'anywhere', userSelect: 'text' });
const sample = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
});
const sampleTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const sampleText = style({ margin: 0, font: 'body-sm', color: 'gray-800', userSelect: 'text', overflowWrap: 'anywhere' });
const note = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });
const result = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
});
const resultTitle = style({ font: 'ui', fontWeight: 'bold', color: { default: 'gray-900', isFailed: 'red-900' } });
const resultText = style({ margin: 0, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere', userSelect: 'text' });
const picture = style({ display: 'block', maxWidth: 'full', maxHeight: 240, borderRadius: 'default', objectFit: 'contain' });
const audio = style({ width: 'full' });
const reply = style({
  margin: 0,
  maxHeight: 200,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  font: 'body-sm',
  color: 'gray-800',
  userSelect: 'text',
});

/**
 * 测试对话框（设计稿 settings-cloud.jsx:348-382）：合成一句话、画一张图，或让文本模型回一句「Reply with OK.」，看服务商能不能返回。
 * 提交的是真的 `models.synthesizeSpeech` / `models.generateImage` / `models.generateText` 任务（服务商可能计费），状态从 `jobs` 主题读；
 * 关掉对话框不撤回请求，这次测试也出现在后台任务里。语音识别在桌面端选择本机文件，复用文件转写流程并保存 TXT/SRT。
 */
export function ProbeDialog({
  capability,
  providerLabel,
  model,
  state,
  onStart,
  onClose,
}: {
  capability: OnlineCapability;
  providerLabel: string;
  model: ModelInfoBase;
  state: ProbeState;
  onStart: (voice: string) => void;
  onClose: () => void;
}) {
  const runtime = useRuntime();
  const asr = capability === 'transcribe';
  const speech = capability === 'synthesizeSpeech';
  const [audioPath, setAudioPath] = useState('');
  const [pickError, setPickError] = useState('');
  const chooseAudio = async () => {
    try {
      const paths = runtime.host.pickFiles
        ? await runtime.host.pickFiles({ title: MANAGEMENT.pickAudio, multiple: false, filters: [{ name: MANAGEMENT.pickAudio, extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'mp4', 'mov', 'webm', 'mkv'] }] })
        : await runtime.host.pickMediaFiles();
      if (paths[0]) setAudioPath(paths[0]);
      setPickError('');
    } catch (err) { setPickError(err instanceof Error ? err.message : String(err)); }
  };
  const textual = capability === 'generateText';
  const needsVoice = speech && probeNeedsVoice(model);
  const [voice, setVoice] = useState('');
  const [media, setMedia] = useState<{ artifactId: string; url: string; preview?: string } | { artifactId: string; failed: string } | null>(null);
  const output = state.status === 'done' ? state.output : null;
  const text = state.status === 'done' ? state.text : null;

  useEffect(() => {
    if (!output || media?.artifactId === output.artifactId) return;
    let live = true;
    const controller = new AbortController();
    probeMediaUrl(runtime, output).then(async (url) => {
      if (output.media.kind === 'text') {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const preview = (await response.text()).slice(0, 12000);
        if (live) setMedia({ artifactId: output.artifactId, url, preview });
      } else if (live) setMedia({ artifactId: output.artifactId, url });
    }).catch(
      (err: Error) => live && setMedia({ artifactId: output.artifactId, failed: err.message }),
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [runtime, output, media]);

  const running = state.status === 'submitting' || state.status === 'running';
  const canStart = !running && (!needsVoice || voice.trim() !== '') && (!asr || (runtime.host.platform !== 'web' && audioPath !== ''));
  const shownVoice = speech ? probeVoice(model as SpeechModelInfo, voice) : undefined;
  const current = output && media?.artifactId === output.artifactId ? media : null;

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        {({ close }) => (
          <>
            <Heading slot="title">{asr ? MANAGEMENT.asrTitle : PROBE_COPY.title[capability]}</Heading>
            <Content>
              <div className={stack}>
                <div>
                  <div className={head}>
                    <span className={provider}>{providerLabel}</span>
                    <Badge variant="neutral" size="S" fillStyle="subtle">
                      {PROBE_COPY.chip[capability]}
                    </Badge>
                  </div>
                  <div className={modelId}>{model.modelId}</div>
                </div>
                <div className={sample}>
                  <span className={sampleTitle}>{asr ? MANAGEMENT.pickAudio : PROBE_COPY.sample[capability]}</span>
                  <p className={sampleText}>{asr ? audioPath : speech ? probeSpeechText() : textual ? PROBE_TEXT_PROMPT : PROBE_IMAGE_PROMPT}</p>
                  {asr ? <Button variant="secondary" isDisabled={running || runtime.host.platform === 'web'} onPress={() => void chooseAudio()}>{MANAGEMENT.pickAudio}</Button> : null}
                  {pickError ? <p className={resultText} role="alert">{pickError}</p> : null}
                  {speech && !needsVoice && shownVoice ? <p className={note}>{PROBE_COPY.voice(shownVoice)}</p> : null}
                </div>
                {needsVoice ? (
                  <TextField
                    label={PROBE_COPY.voiceField}
                    description={PROBE_COPY.voiceDesc}
                    value={voice}
                    onChange={setVoice}
                    isDisabled={running}
                  />
                ) : null}
                <p className={note}>
                  {asr ? runtime.host.platform === 'web' ? MANAGEMENT.desktopOnly : MANAGEMENT.asrNote : PROBE_COPY.note[capability]}
                  {PROBE_COPY.cost}
                </p>
                <div className={result} role="status" aria-live="polite" aria-label={PROBE_COPY.result}>
                  <span className={resultTitle({ isFailed: state.status === 'failed' })}>
                    {state.status === 'ready'
                      ? PROBE_COPY.ready
                      : running
                        ? asr ? MANAGEMENT.asrRunning : PROBE_COPY.running[capability]
                        : state.status === 'done'
                          ? PROBE_COPY.done(state.seconds)
                          : PROBE_COPY.failed}
                  </span>
                  {state.status === 'failed' ? <p className={resultText}>{state.message}</p> : null}
                  {text ? (
                    <>
                      <pre className={reply}>{text.preview}</pre>
                      <p className={note}>
                        {textProbeFacts(text)} · {PROBE_COPY.textResultNote}
                      </p>
                    </>
                  ) : null}
                  {output ? (
                    <>
                      {current && 'url' in current ? (
                        output.media.kind === 'text' ? (
                          <pre className={reply}>{current.preview ?? ''}</pre>
                        ) : output.media.kind === 'audio' ? (
                          <audio className={audio} controls preload="metadata" src={current.url} aria-label={PROBE_COPY.result} />
                        ) : (
                          <img className={picture} src={current.url} alt={PROBE_COPY.result} />
                        )
                      ) : current && 'failed' in current ? (
                        <p className={resultText}>{PROBE_COPY.openFailed(current.failed)}</p>
                      ) : null}
                      <p className={note}>
                        {outputFacts(output)} · {asr ? output.path : PROBE_COPY.resultNote}
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {PROBE_COPY.close}
              </Button>
              <Button variant="accent" isDisabled={!canStart} isPending={running} onPress={() => onStart(asr ? audioPath : voice)}>
                {running ? PROBE_COPY.testing : state.status === 'ready' ? PROBE_COPY.start : PROBE_COPY.retry}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
