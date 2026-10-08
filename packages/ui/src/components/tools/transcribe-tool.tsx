import { useState } from 'react';
import type { JobRecord } from '@baocut/protocol';
import { Button, Content, DropZone, Heading, InlineAlert, Radio, RadioGroup, TextField, ToastQueue } from '@react-spectrum/s2';
import Upload from '@react-spectrum/s2/icons/Upload';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { DropItem } from 'react-aria-components';
import { downloadDirLabel } from '../../model/link-import.ts';
import { urlValid } from '../../model/new-flow.ts';
import { entryPath } from '../../model/space.ts';
import { targetOptions } from '../../model/tool-catalog.ts';
import { saveTarget } from '../../model/tool-frame.ts';
import { linkParams, toolRequest, transcribeFileParams, transcribeParams, type AsrChoice, type RunMeta } from '../../model/tool-runs.ts';
import { inputKindOf, SPACE_INPUT_COPY } from '../../model/tool-space-input.ts';
import {
  DEFAULT_DESTINATION,
  DUPLICATE_TITLE,
  duplicateNote,
  newVideoName,
  pick,
  replaceImpact,
  retargetOptions,
  retryParamsOf,
  type PickerRow,
  type RetargetOption,
} from '../../model/tool-targets.ts';
import { agoLabel } from '../../model/format.ts';
import { jobErrorText } from '../../model/localized-text.ts';
import { findOption, modelKeyOf } from '../../model/tools-models.ts';
import { baseName, isTranscribable, mediaFormats, transcribeOptions, type TranscribeMode } from '../../model/tools-transcribe.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDirectory } from '../../state/directory-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { changeDownloadDir, useDownloaderTool } from '../start/downloader-card.tsx';
import { LinkSource } from '../start/flow-media.tsx';
import { SaveDirRow } from './tool-frame.tsx';
import { GrantCard, ProjectPicker, ToolFrame, ToolSourceSwitch } from './tool-run-view.tsx';
import { detail, Section, submitOnModEnter } from './tool-parts.tsx';
import { SpacePicker, useCandidates, useSpaceRows } from './tool-video-picker.tsx';
import { FORM_COPY, GRANT_COPY, RETRANSCRIBE_COPY, TRANSCRIBE_COPY, TRANSCRIBE_TOOL_COPY } from './tools-copy.ts';
import { AsrFields, useAsrPick } from './transcribe-asr.tsx';
import { blockOf, useToolStatus } from './use-tool-status.ts';
import { defaultProject, useToolStart, useVideoTools, type TranscribeDraft } from './use-video-tools.ts';
import { DuplicateAlert, firstWhy, lede, SubmitBar, usePreset, useRefreshWhenReady } from './video-tool-parts.tsx';

/*
 * 工具 › 转录（设计稿 tool-transcribe.jsx `TranscribeToolPage`、tools.css `.tool-transcribe__input`；产品设计 §2.7 表二「转录」）：
 * 从本机文件、Space（媒体条目或可编辑的视频）或一个链接开始。文件、媒体条目与链接缺省不建视频：文稿（TXT）与字幕（SRT）
 * 保存到保存位置（只给文件的 `transcribe`，`TranscribeFileParams`）；改选「新建视频并放进项目」时新建视频（素材留在原处只做
 * 链接），带文稿与可编辑的字幕层。选可编辑的视频时写进它；已有文稿时给落点（产品设计 §5.11）：缺省新建一部视频，
 * 或「取代这部视频的文稿」（换用文稿，选它时显示影响卡；文稿被改过时 Runtime 拒绝，页面给「仍要取代」）。
 * 「重试转录…」（Space，§4.4）带来失败的任务：照它预填语音模型、语言与说话人，并说明上次失败的原因。执行方式读 `tools.list`。
 *
 * 链接来源由「从链接导入」的流程执行（`link-import` 带 `transcribe: true`，可用性也看它）：那条路径还不能选语音模型与语言、
 * 不建字幕层，也没有这一次的保存位置（下载到设置里的保存位置），页面照实说。
 */

const dropZone = style({ width: 'full', minHeight: 200 });
const dropBody = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingY: 24, paddingX: 24, textAlign: 'center' });
const dropIcon = style({ display: 'flex', color: 'gray-700', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const dropName = style({ font: 'title-sm', color: 'gray-900', overflowWrap: 'anywhere' });
const dropPath = style({ font: 'code-xs', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const dropFormats = style({ font: 'ui-xs', color: 'gray-600' });
const buttons = style({ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 });
const sub = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const impactBox = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const impactHead = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const impactRow = style({ display: 'flex', gap: 12, font: 'ui-sm', color: 'gray-800', minWidth: 0 });
const impactKey = style({ flexShrink: 0, width: 64, color: 'gray-600' });
const impactValue = style({ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' });

export function TranscribeTool() {
  const runtime = useRuntime();
  const status = useToolStatus();
  const draft = useVideoTools((s) => s.transcribe);
  const patchVideoTools = useVideoTools((s) => s.patch);
  const patch = (p: Partial<TranscribeDraft>) => patchVideoTools('transcribe', p);
  const lastProject = useVideoTools((s) => s.lastProject);
  const setLastProject = useVideoTools((s) => s.setLastProject);
  const projects = useDirectory((s) => s.projects);
  const conversations = useDirectory((s) => s.conversations);
  const data = useCandidates('transcribe');
  const rows = useSpaceRows('transcribe', data);
  const asr = useAsrPick();
  const link = draft.source === 'link';
  const downloader = useDownloaderTool(link);
  const downloadSetting = useSetting('downloads.directory');
  const [saveOverride, setSaveOverride] = useState<string | null>(null);

  usePreset('transcribe', (entryId, preset) => {
    const job = preset.retryJobId ? useJobs.getState().jobs.find((j) => j.jobId === preset.retryJobId) : undefined;
    patch({ source: 'space', entryId, retry: job ? { entryId, jobId: job.jobId } : null });
    if (job) prefillAsr(job);
  });

  useRefreshWhenReady(downloader.ready);

  const projectId = draft.projectId && projects.some((p) => p.id === draft.projectId) ? draft.projectId : defaultProject(projects, lastProject);
  const project = projects.find((p) => p.id === projectId) ?? null;
  const entryId = draft.source === 'space' ? pick(rows, draft.entryId) : null;
  const row = entryId ? (rows.find((r) => r.entryId === entryId) ?? null) : null;
  const intoVideo = row?.kind === 'video';
  const create = !intoVideo && draft.target === 'create';
  const url = draft.url.trim();
  const urlOk = urlValid(url);
  // 「识别说话人」总是明确给 true / false（设计稿 `speakers: sp.on`），不让 Runtime 按模型猜；只给文件的转录不收它。
  // 落点（§5.11）：视频已有文稿时才有；在这部视频上选过就用选的，否则缺省新建视频。
  const retarget = intoVideo && row.video ? retargetOptions(row.video) : null;
  const ownDest = retarget && draft.dest?.entryId === row?.entryId ? draft.dest : null;
  const destination = retarget ? (ownDest?.destination ?? DEFAULT_DESTINATION) : null;
  const defaultName = row ? newVideoName(row.name) : '';
  const newName = ownDest ? ownDest.name : defaultName;
  const setDest = (next: Partial<{ destination: RetargetOption['key']; name: string }>) =>
    row && patch({ dest: { entryId: row.entryId, destination: destination ?? DEFAULT_DESTINATION, name: newName, ...next } });
  const retryJobId = draft.retry && draft.retry.entryId === entryId ? draft.retry.jobId : null;
  const retryJob = useJobs((s) => (retryJobId ? s.jobs.find((j) => j.jobId === retryJobId) : undefined));
  const choice: AsrChoice = asr.option?.usable
    ? { provider: asr.option.providerId, model: asr.option.modelId, language: asr.language, diarize: asr.speakers.s.on }
    : {};
  const spaceMedia = row && !intoVideo && row.entry ? entryPath(row.entry, { projects, conversations }) : null;

  // 链接来源的可用性与执行方式都看从链接导入；Space 条目按它是视频还是文件。
  const via = link ? 'link-import' : 'transcribe';
  const input = link ? 'link' : row ? inputKindOf('transcribe', row.kind) : 'file';
  const block = blockOf(status, via, input);
  const outDir = saveTarget(status.saveDirectory, saveOverride);
  let params: Record<string, unknown> | null = null;
  if (draft.source === 'file' && draft.path) {
    if (!create) params = transcribeFileParams(draft.path, choice, outDir);
    else if (projectId) params = transcribeParams({ create: { projectId, media: draft.path } }, choice);
  } else if (draft.source === 'space' && row) {
    if (intoVideo)
      params = transcribeParams(
        { entryId: row.entryId },
        choice,
        null,
        destination ? { destination, name: newName.trim() || defaultName } : null,
      );
    else if (!create) params = transcribeFileParams({ entryId: row.entryId }, choice, outDir);
    else if (projectId && spaceMedia) params = transcribeParams({ create: { projectId, media: spaceMedia } }, choice);
  } else if (link && urlOk) {
    if (!create) params = { url, transcribe: true };
    else if (projectId) params = linkParams({ url, target: 'create', projectId, transcribe: true });
  }
  const request = params ? toolRequest(status.byId.get(via), input, params) : null;
  const key = request ? JSON.stringify(request) : '';
  const starter = useToolStart('transcribe', key);
  const writesVideo = intoVideo || create;

  const asrWhy = !asr.view
    ? FORM_COPY.loading
    : !asr.option
      ? asr.mode === 'cloud'
        ? TRANSCRIBE_TOOL_COPY.noCloud
        : TRANSCRIBE_TOOL_COPY.noLocal
      : !asr.option.usable
        ? TRANSCRIBE_TOOL_COPY.modelNotReady
        : writesVideo && asr.speakers.s.missing
          ? TRANSCRIBE_TOOL_COPY.needSpeakers
          : null;
  // 下载工具没就绪时 Runtime 的原因是写给命令行的（externalTools.consent…）；页面里就是下载工具卡，先指向它。
  const needTool = downloader.updating ? FORM_COPY.toolUpdating : FORM_COPY.needTool;
  const why = firstWhy(
    link && block && !downloader.ready ? needTool : block,
    draft.source === 'file' && !draft.path && FORM_COPY.needFile,
    link && !urlOk && FORM_COPY.needUrl,
    draft.source === 'space' && !row && FORM_COPY.needEntry,
    create && !projectId && FORM_COPY.needProject,
    create && draft.source === 'space' && row && !intoVideo && !spaceMedia && SPACE_INPUT_COPY.noPath,
    link && !downloader.ready && needTool,
    !link && asrWhy,
    !!starter.asking && FORM_COPY.needGrant,
    !request && FORM_COPY.loading,
  );

  const start = () => {
    if (why || !request) return;
    const what = draft.source === 'file' ? baseName(draft.path ?? '') : link ? url.replace(/^https?:\/\//, '') : (row?.name ?? '');
    const meta: RunMeta = {
      tool: 'transcribe',
      input,
      title: `${TRANSCRIBE_COPY.title} · ${what}`,
      videoName: intoVideo ? (row?.name ?? null) : null,
      projectName: create ? (project?.name ?? null) : null,
      target: intoVideo ? 'video' : create ? 'create' : 'none',
      ...(link ? { transcribe: true } : {}),
    };
    if (create && projectId) setLastProject(projectId);
    starter.start(request, meta, key);
  };

  const dup = row?.video ? duplicateNote('transcribe', row.video) : null;
  const projectName = row?.video?.projectId ? (projects.find((p) => p.id === row.video?.projectId)?.name ?? null) : null;
  const label = link ? TRANSCRIBE_TOOL_COPY.submitLink : TRANSCRIBE_TOOL_COPY.submit;

  return (
    <ToolFrame
      tool="transcribe"
      title={TRANSCRIBE_COPY.title}
      bar={<SubmitBar why={why} label={label} busy={starter.busy} onPress={start} />}
      onKeyDown={submitOnModEnter(start)}>
      <p className={lede}>{TRANSCRIBE_TOOL_COPY.lede}</p>
      <ToolSourceSwitch tool="transcribe" value={draft.source} onChange={(source) => patch({ source })} />
      {retryJob ? <RetryAlert job={retryJob} /> : null}
      {draft.source === 'file' ? <FileDrop path={draft.path} onPath={(path) => patch({ path })} /> : null}
      {link ? (
        <Section>
          <LinkSource
            url={draft.url}
            onUrl={(next) => patch({ url: next })}
            downloader={downloader}
            downloadDir={downloadDirLabel(downloadSetting ?? null, project?.path ?? null)}
            onChangeDir={() => void changeDownloadDir(runtime)}
            note={TRANSCRIBE_TOOL_COPY.linkNote}
          />
        </Section>
      ) : null}
      {draft.source === 'space' ? <SpacePicker tool="transcribe" data={data} value={entryId} onChange={(id) => patch({ entryId: id })} /> : null}
      {dup ? <DuplicateAlert title={DUPLICATE_TITLE.transcribe} body={dup} /> : null}
      {link ? (
        <Section title={TRANSCRIBE_TOOL_COPY.asrTitle}>
          <span className={detail}>{TRANSCRIBE_TOOL_COPY.linkAsr}</span>
        </Section>
      ) : (
        <AsrFields pick={asr} speakers={writesVideo} />
      )}
      {starter.edited ? (
        <InlineAlert variant="notice">
          <Heading>{RETRANSCRIBE_COPY.editedTitle}</Heading>
          <Content>
            <div className={sub}>
              <span>{RETRANSCRIBE_COPY.editedBody}</span>
              <div>
                <Button variant="secondary" isPending={starter.busy} onPress={starter.acceptEdited}>
                  {RETRANSCRIBE_COPY.editedAccept}
                </Button>
              </div>
            </div>
          </Content>
        </InlineAlert>
      ) : null}
      {retarget && destination && row?.video ? (
        <Section title={RETRANSCRIBE_COPY.destTitle}>
          <RadioGroup
            aria-label={RETRANSCRIBE_COPY.destLabel}
            value={destination}
            onChange={(value) => setDest({ destination: value as RetargetOption['key'] })}>
            {retarget.map((o) => (
              <Radio key={o.key} value={o.key}>
                {o.label}
              </Radio>
            ))}
          </RadioGroup>
          {destination === 'new-video' ? (
            <div className={sub}>
              <TextField label={RETRANSCRIBE_COPY.nameLabel} value={newName} onChange={(name) => setDest({ name })} />
              <span className={detail}>{RETRANSCRIBE_COPY.newVideoNote(projectName, row.name)}</span>
            </div>
          ) : (
            <ReplaceImpactCard video={row.video} />
          )}
        </Section>
      ) : null}
      {intoVideo ? null : (
        <Section title={TRANSCRIBE_TOOL_COPY.targetTitle}>
          <RadioGroup aria-label={TRANSCRIBE_TOOL_COPY.targetTitle} value={draft.target} onChange={(target) => patch({ target: target as TranscribeDraft['target'] })}>
            {targetOptions('transcribe').map((o) => (
              <Radio key={o.key} value={o.key}>
                {o.label}
              </Radio>
            ))}
          </RadioGroup>
          {create ? <ProjectPicker value={projectId} onChange={(id) => patch({ projectId: id })} /> : null}
          <span className={detail}>{!create ? TRANSCRIBE_TOOL_COPY.targetNone : link ? TRANSCRIBE_TOOL_COPY.createLink : TRANSCRIBE_TOOL_COPY.createFile}</span>
        </Section>
      )}
      {!writesVideo && !link ? <SaveDirRow saveDirectory={status.saveDirectory} override={saveOverride} onChange={setSaveOverride} /> : null}
      {starter.asking ? (
        <GrantCard
          items={starter.asking}
          onAgree={starter.agree}
          busy={starter.busy}
          hint={asr.mode === 'cloud' || link ? GRANT_COPY.hintLocal : GRANT_COPY.hintCloud}
        />
      ) : null}
    </ToolFrame>
  );
}

// ---- 重新转录 ----

/** 选「取代」时的影响卡（设计稿 `ReplaceImpact`）：每种译文一行、规则一句、每种语言的配音一行、可以撤销。 */
function ReplaceImpactCard({ video }: { video: Pick<PickerRow, 'documents'> }) {
  const im = replaceImpact(video);
  const row = (key: string, label: string, text: string) => (
    <div key={key} className={impactRow}>
      <span className={impactKey}>{label}</span>
      <span className={impactValue}>{text}</span>
    </div>
  );
  return (
    <div className={impactBox}>
      <span className={impactHead}>{RETRANSCRIBE_COPY.impactTitle}</span>
      {im.translations.length
        ? im.translations.map((t, i) => row(`tr-${i}`, RETRANSCRIBE_COPY.impactTranslations, t))
        : row('tr', RETRANSCRIBE_COPY.impactTranslations, RETRANSCRIBE_COPY.impactNone)}
      {im.rule ? <span className={detail}>{im.rule}</span> : null}
      {im.dubs.map((d, i) => row(`dub-${i}`, RETRANSCRIBE_COPY.impactDubs, d))}
      <span className={detail}>{im.undo}</span>
    </div>
  );
}

/** 「重试转录…」带来的失败（设计稿 `RetryAlert`）：原因、上次的模型与多久前。 */
function RetryAlert({ job }: { job: JobRecord }) {
  const p = retryParamsOf(job);
  const view = useModels((s) => s.capabilities);
  const key = p.provider && p.model ? modelKeyOf(p.provider, p.model) : null;
  const option =
    view && key ? (findOption(transcribeOptions(view, 'local'), key) ?? findOption(transcribeOptions(view, 'cloud'), key)) : null;
  const model = option?.label ?? p.model;
  return (
    <InlineAlert variant="negative">
      <Heading>{RETRANSCRIBE_COPY.retryTitle}</Heading>
      <Content>{RETRANSCRIBE_COPY.retryBody(jobErrorText(job.error), model, agoLabel(job.updatedAt))}</Content>
    </InlineAlert>
  );
}

/** 照失败那次填语音模型、语言与识别说话人（工具页的语音模型存在 tools-store）。模型在两张单子里都找不到时不改。 */
function prefillAsr(job: JobRecord): void {
  const p = retryParamsOf(job);
  const view = useModels.getState().capabilities;
  const patch: Parameters<ReturnType<typeof useTools.getState>['patchTranscribe']>[0] = { language: p.language ?? '' };
  if (p.provider && p.model) {
    const key = modelKeyOf(p.provider, p.model);
    const mode: TranscribeMode | null = !view
      ? null
      : transcribeOptions(view, 'local').some((o) => o.key === key)
        ? 'local'
        : transcribeOptions(view, 'cloud').some((o) => o.key === key)
          ? 'cloud'
          : null;
    if (mode) Object.assign(patch, { mode, model: key });
  }
  if (p.diarize !== null) patch.speakers = p.diarize;
  useTools.getState().patchTranscribe(patch);
}

// ---- 本机文件 ----

/** 拖入或选一份音视频（设计稿 `.tool-transcribe__input`）。 */
function FileDrop({ path, onPath }: { path: string | null; onPath: (path: string | null) => void }) {
  const runtime = useRuntime();
  const take = (next: string) => {
    if (!isTranscribable(baseName(next))) {
      ToastQueue.neutral(TRANSCRIBE_COPY.notMedia, { timeout: 4000 });
      return;
    }
    onPath(next);
  };
  const choose = () => {
    void runtime.host.pickMediaFiles().then((paths) => {
      if (paths[0]) take(paths[0]);
    });
  };
  const drop = async (items: readonly DropItem[]) => {
    const item = items.find((i) => i.kind === 'file');
    if (!item || item.kind !== 'file') return;
    const file = await item.getFile();
    if (!isTranscribable(file.name)) {
      ToastQueue.neutral(TRANSCRIBE_COPY.notMedia, { timeout: 4000 });
      return;
    }
    const local = runtime.host.pathForFile(file);
    if (!local) {
      ToastQueue.negative(TRANSCRIBE_COPY.noPath, { timeout: 6000 });
      return;
    }
    onPath(local);
  };
  return (
    <DropZone styles={dropZone} isFilled={!!path} replaceMessage={TRANSCRIBE_COPY.change} onDrop={(e) => void drop(e.items)}>
      <div className={dropBody}>
        <span className={dropIcon} aria-hidden>
          <Upload />
        </span>
        <span className={dropName}>{path ? baseName(path) : TRANSCRIBE_COPY.drop}</span>
        {path ? <span className={dropPath}>{path}</span> : null}
        <span className={dropFormats}>{mediaFormats()}</span>
        <div className={buttons}>
          <Button variant="secondary" onPress={choose}>
            {path ? TRANSCRIBE_COPY.change : TRANSCRIBE_COPY.pick}
          </Button>
          {path ? (
            <Button variant="secondary" fillStyle="outline" onPress={() => onPath(null)}>
              {TRANSCRIBE_COPY.clearFile}
            </Button>
          ) : null}
        </div>
      </div>
    </DropZone>
  );
}

