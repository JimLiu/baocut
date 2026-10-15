import { useMemo, useRef, useState } from 'react';
import type { JobRecord, MusicMode } from '@baocut/protocol';
import { ActionButton, Button, SegmentedControl, SegmentedControlItem, Slider, Text, TextField, ToastQueue, ToggleButton } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { downloadableBundle } from '../../model/models-install.ts';
import { modelReason, saveTarget, withSaveDir } from '../../model/tool-frame.ts';
import { findOption, initialModelKey } from '../../model/tools-models.ts';
import {
  DURATION,
  maxOf,
  maxSecOf,
  modeDesc,
  modeLabel,
  modesOf,
  musicAgainDraft,
  musicHeaderChip,
  musicModelLine,
  musicModelOptions,
  musicProblems,
  musicRequest,
  musicStatus,
  MUSIC_STYLES,
  planningDesc,
  planningFor,
  planningLabel,
  planningsOf,
  setTarget,
  soundtrackFor,
  styleLabel,
  switchMusicModel,
  tokens,
  TOKENS_PER_SEC,
  etaText,
} from '../../model/tools-music.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { useNow } from '../use-now.ts';
import { MusicIcon } from '../music-icon.tsx';
import { MUSIC_LOCAL_COPY } from '../models/music-local-copy.ts';
import { EmptyCard, PageStatus } from '../models/model-parts.tsx';
import { LocalDownloadGate } from './local-model-gate.tsx';
import { MusicRecord } from './music-record.tsx';
import { MUSIC_TOOL_COPY as COPY } from './music-tool-copy.ts';
import { ModelRow, SaveDirRow } from './tool-frame.tsx';
import {
  BarStatus,
  detail,
  detailGrow,
  HeaderChip,
  Row,
  Section,
  SectionLink,
  SideFoot,
  SideHead,
  submitOnModEnter,
  ToolPage,
  ToolTextArea,
  Workbench,
} from './tool-parts.tsx';
import { GALLERY_COPY, RECORD_COPY, SAVE_COPY } from './tools-copy.ts';
import { useSubmitFailed, useToolRecords } from './use-tool-records.ts';
import { useToolStatus } from './use-tool-status.ts';
import type { ToolPreset } from './use-video-tools.ts';
import { usePreset, useRerun } from './video-tool-parts.tsx';

/*
 * 设计稿 tool-music.jsx `MusicToolPage`：形式 → 风格（英文描述，芯片可填）→ 歌词（带唱时）→ 时长（目标与上限）→ 规划 → 模型与种子 → 保存位置，
 * 右边生成记录。只用本机模型（音乐生成没有云端服务商）。字段与 Runtime 的 GenerateMusicRequest 同名（model/tools-music.ts）。
 * 从编辑器 AI 工具「生成配乐」进来时（`ToolPreset.soundtrack`）时长按那部视频预填（比模型的单次上限长时预填上限、横幅写明循环铺满），
 * 提交带 `videoId`，做好后 Runtime 把它导入那部视频的素材，编辑器再铺上音乐轨（editor/soundtrack-bed.tsx）。
 */

const chips = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 });
const slider = style({ flexGrow: 1, minWidth: 160 });
/** 滑块自带的读数写成本地化的「30 秒 / 30 sec」；上限不吃 5 秒步长，跟着目标的「多两成」（如 36）要能原样显示。 */
const SECONDS: Intl.NumberFormatOptions = { style: 'unit', unit: 'second', unitDisplay: 'short' };
const seedField = style({ width: 140 });
const card = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 4,
  padding: 12,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'informative-700',
  backgroundColor: 'informative-subtle',
  minWidth: 0,
});
const cardTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });

type Soundtrack = NonNullable<ToolPreset['soundtrack']>;

/** 生成音乐（本机）。提交走 `models.generateMusic`，记录是 `jobs` 主题里这类任务。 */
export function MusicTool() {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const view = useModels((s) => s.capabilities);
  const bundles = useModels((s) => s.bundles);
  const draft = useTools((s) => s.music);
  const patch = useTools((s) => s.patchMusic);
  const records = useToolRecords('generateMusic');
  const now = useNow(30_000);
  const styleRef = useRef<HTMLTextAreaElement>(null);
  const [tried, setTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitFailed = useSubmitFailed('generateMusic', COPY.submitFailed);
  const { saveDirectory } = useToolStatus();
  const [saveOverride, setSaveOverride] = useState<string | null>(null);
  // 「生成配乐」带来的那部视频；只活在这一页，提交一次后清掉。
  const [soundtrack, setSoundtrack] = useState<Soundtrack | null>(null);

  const options = useMemo(() => (view ? musicModelOptions(view) : []), [view]);
  const option = findOption(options, initialModelKey(options, draft.model, view?.generateMusic.effective ?? null));
  const info = option?.info ?? null;
  const limit = maxSecOf(info);

  usePreset('generate-music', (_entryId, preset) => {
    if (!preset.soundtrack) return;
    setSoundtrack(preset.soundtrack);
    patch(setTarget(draft, soundtrackFor(preset.soundtrack.videoSec, limit).targetDurationSec));
  });
  // 视频比选中模型的单次上限长：横幅写明会生成上限长度并循环铺满（换了模型按它的上限重新判断）。
  const soundtrackLoop = soundtrack ? soundtrackFor(soundtrack.videoSec, limit).loop : false;

  const reason = view ? modelReason(options, option, COPY.noun) : null;
  const status = reason ? { text: reason, bad: true } : musicStatus(draft, option, tried);
  const toSettings = () => go({ tab: 'models', category: 'music' });
  const gateBundle = downloadableBundle(bundles, option);

  const generate = () => {
    setTried(true);
    if (!option || !option.usable || submitting) return;
    const problems = musicProblems(draft, option);
    if (problems.length) {
      ToastQueue.neutral(problems[0]!, { timeout: 4000 });
      return;
    }
    const target = soundtrack;
    setSubmitting(true);
    runtime
      .generateMusic(withSaveDir(musicRequest(draft, option, target?.videoId ?? null), saveTarget(saveDirectory, saveOverride)))
      .then((jobId) => {
        if (!target) {
          ToastQueue.positive(COPY.submitted, { timeout: 3000 });
          return;
        }
        // 带视频的任务不进这一页的记录（工具记录只列不带视频的），给一个去后台任务的按钮。
        setSoundtrack(null);
        ToastQueue.positive(COPY.submittedFor(target.videoName), {
          actionLabel: COPY.viewTask,
          onAction: () => go({ tab: 'tasks', taskId: jobId }),
          shouldCloseOnAction: true,
        });
      }, submitFailed)
      .finally(() => setSubmitting(false));
  };

  const reuse = (job: JobRecord) => {
    const next = musicAgainDraft(job);
    if (!next) return;
    patch(next);
    styleRef.current?.focus();
    ToastQueue.neutral(COPY.reused, { timeout: 3000 });
  };
  useRerun('generate-music', reuse);

  const bar = (
    <>
      <BarStatus text={status.text} bad={status.bad} />
      <Button variant="accent" isDisabled={!option?.usable} isPending={submitting} onPress={generate}>
        <MusicIcon />
        <Text>{COPY.submit}</Text>
      </Button>
    </>
  );

  if (!view) {
    return (
      <ToolPage title={COPY.title}>
        <PageStatus>{GALLERY_COPY.loading}</PageStatus>
      </ToolPage>
    );
  }

  const modes = modesOf(info);
  const mode = modes.includes(draft.mode) ? draft.mode : (modes[0] ?? draft.mode);
  const plannings = planningsOf(info);
  const planning = planningFor(draft, info);
  const max = maxOf(draft, limit);
  const modelName = (job: JobRecord) => options.find((o) => o.providerId === job.providerId && o.modelId === job.modelId)?.label ?? job.modelId;

  const main = (
    <>
      {soundtrack ? (
        <div className={card} role="note">
          <span className={cardTitle}>{COPY.soundtrackTitle(soundtrack.videoName)}</span>
          <span className={detail}>
            {soundtrackLoop ? COPY.soundtrackLoopBody(Math.round(soundtrack.videoSec), limit) : COPY.soundtrackBody(draft.targetDurationSec)}
          </span>
          <ActionButton isQuiet size="S" onPress={() => setSoundtrack(null)}>
            <Text>{COPY.soundtrackOff}</Text>
          </ActionButton>
        </div>
      ) : null}

      <Section title={COPY.mode}>
        <SegmentedControl aria-label={COPY.mode} selectedKey={mode} onSelectionChange={(key) => patch({ mode: key as MusicMode })}>
          {modes.map((m) => (
            <SegmentedControlItem key={m} id={m}>
              {modeLabel(m)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <span className={detail}>{modeDesc(mode)}</span>
      </Section>

      <Section title={COPY.style} aside={<span className={detail}>{COPY.styleAside}</span>}>
        <ToolTextArea label={COPY.style} inputRef={styleRef} value={draft.style} onChange={(s) => patch({ style: s })} placeholder={COPY.stylePlaceholder} compact />
        <div className={chips}>
          {MUSIC_STYLES.map((s) => (
            <ToggleButton key={s.key} size="S" isSelected={draft.style === s.style} onChange={() => patch({ style: s.style })}>
              {styleLabel(s.key)}
            </ToggleButton>
          ))}
          {draft.style ? <SectionLink onPress={() => patch({ style: '' })}>{COPY.clear}</SectionLink> : null}
        </div>
      </Section>

      {mode === 'song' ? (
        <Section title={COPY.lyrics} aside={<span className={detail}>{COPY.lyricsAside}</span>}>
          <ToolTextArea label={COPY.lyrics} value={draft.lyrics} onChange={(lyrics) => patch({ lyrics })} placeholder={COPY.lyricsPlaceholder} />
        </Section>
      ) : null}

      <Section title={COPY.duration} aside={<span className={detail}>{etaText(draft.targetDurationSec, { planning })}</span>}>
        <Row label={COPY.target}>
          <Slider
            aria-label={COPY.target}
            labelPosition="side"
            size="S"
            formatOptions={SECONDS}
            styles={slider}
            minValue={DURATION.min}
            maxValue={limit}
            step={DURATION.step}
            value={Math.min(draft.targetDurationSec, limit)}
            onChange={(sec) => patch(setTarget(draft, sec))}
          />
        </Row>
        <Row label={COPY.limit}>
          <Slider
            aria-label={COPY.limit}
            labelPosition="side"
            size="S"
            formatOptions={SECONDS}
            styles={slider}
            minValue={Math.min(draft.targetDurationSec, limit)}
            maxValue={limit}
            step={1}
            value={max}
            onChange={(sec) => patch({ maxDurationSec: sec })}
          />
          {draft.maxDurationSec !== null ? <SectionLink onPress={() => patch({ maxDurationSec: null })}>{COPY.followTarget}</SectionLink> : null}
        </Row>
        <span className={detail}>{COPY.durationNote(tokens(max), TOKENS_PER_SEC)}</span>
      </Section>

      <Section title={COPY.planning}>
        <div className={chips}>
          {plannings.map((p) => (
            <ToggleButton key={p} size="S" isSelected={planning === p} onChange={() => patch({ planning: p })}>
              {planningLabel(p)}
            </ToggleButton>
          ))}
        </div>
        <span className={detail}>{planningDesc(planning)}</span>
      </Section>

      <ModelRow
        noun={COPY.noun}
        manage={COPY.manage}
        onSettings={toSettings}
        options={options}
        selected={option}
        onSelect={(o) => patch(switchMusicModel(draft, o))}
        factsOf={(o) => musicModelLine(o.info)}
        localGate={!!gateBundle}>
        {gateBundle && option ? (
          <LocalDownloadGate
            bundle={gateBundle}
            name={option.label}
            category="music"
            licenseUse={MUSIC_LOCAL_COPY.licenseUse}
            body={(paused) => (paused ? COPY.downloadBodyPaused : COPY.downloadBody)}
          />
        ) : null}
        {info?.acceptsSeed ? (
          <Row label={COPY.seed}>
            <TextField
              aria-label={COPY.seed}
              size="S"
              styles={seedField}
              inputMode="numeric"
              placeholder={COPY.seedPlaceholder}
              value={draft.seed}
              onChange={(seed) => patch({ seed: seed.replace(/[^\d]/g, '') })}
            />
            <span className={detailGrow}>{COPY.seedNote}</span>
          </Row>
        ) : null}
      </ModelRow>

      <SaveDirRow saveDirectory={saveDirectory} override={saveOverride} onChange={setSaveOverride} note={COPY.saveNote} />
    </>
  );

  const list = records.list.filter((job) => job.state !== 'cancelled');
  const side = (
    <>
      <SideHead
        title={COPY.side}
        live={records.live ? RECORD_COPY.live(records.live) : null}
        count={RECORD_COPY.count(list.length)}
        extra={
          <ActionButton isQuiet size="S" onPress={() => go({ tab: 'space', category: 'audio', projectId: null })}>
            <Text>{SAVE_COPY.view}</Text>
          </ActionButton>
        }
      />
      {!records.ready ? (
        <PageStatus>{GALLERY_COPY.loading}</PageStatus>
      ) : list.length ? (
        list.map((job) => <MusicRecord key={job.jobId} job={job} all={records.all} modelName={modelName(job)} now={now} onReuse={reuse} />)
      ) : (
        <EmptyCard icon={<MusicIcon />} title={COPY.empty} body={COPY.emptyBody} />
      )}
      <SideFoot>{COPY.sideFoot}</SideFoot>
    </>
  );

  return (
    <ToolPage title={COPY.title} bar={bar} chip={<HeaderChip text={musicHeaderChip(option)} />}>
      <Workbench main={main} side={side} sideLabel={COPY.side} onKeyDown={submitOnModEnter(generate)} />
    </ToolPage>
  );
}
