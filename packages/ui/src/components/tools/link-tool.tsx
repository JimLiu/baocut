import { Picker, PickerItem, Switch, Text } from '@react-spectrum/s2';
import { cookieSummary } from '../../model/link-cookies.ts';
import { downloadDirLabel } from '../../model/link-import.ts';
import { urlValid } from '../../model/new-flow.ts';
import { toolRequest, type RunMeta } from '../../model/tool-runs.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useCookieBrowserChoice } from '../../state/cookie-browsers-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { S } from '../shell-copy.ts';
import { changeDownloadDir, DownloaderSummary, useDownloaderTool } from '../start/downloader-card.tsx';
import { LinkSource } from '../start/flow-media.tsx';
import { GrantCard, ToolFrame } from './tool-run-view.tsx';
import { detail, Section, submitOnModEnter } from './tool-parts.tsx';
import { FORM_COPY, LINK_TOOL_COPY } from './tools-copy.ts';
import { blockOf, useToolStatus } from './use-tool-status.ts';
import { useToolStart, useVideoTools, type LinkDraft } from './use-video-tools.ts';
import { firstWhy, lede, SubmitBar, useRefreshWhenReady } from './video-tool-parts.tsx';

/**
 * 下载视频（产品设计 §2.7）。下载工具与网站登录都在设置 › 视频下载里管理，这里只摘要（设计稿 tool-link.jsx 的 DownloadSummary）；
 * 开始时按当时检测到的浏览器把网站登录的设置（`downloads.cookieBrowsers`）展开成浏览器列表，冻结进这一次下载。
 */
/** Download a file; optional transcription publishes TXT/SRT without an editing video. */
export function LinkTool() {
  const runtime = useRuntime();
  const status = useToolStatus();
  const draft = useVideoTools((s) => s['link-import']);
  const patchTools = useVideoTools((s) => s.patch);
  const patch = (p: Partial<LinkDraft>) => patchTools('link-import', p);
  const projects = useDirectory((s) => s.projects);
  const downloader = useDownloaderTool(true);
  const downloadSetting = useSetting('downloads.directory');
  useRefreshWhenReady(downloader.ready);
  const cookies = useCookieBrowserChoice(true);
  const cookieBrowsers = cookies.list;
  const projectId = draft.transcribe && projects.some((p) => p.id === draft.projectId && !p.missing) ? draft.projectId : null;
  const params = {
    url: draft.url.trim(), transcribe: draft.transcribe,
    ...(projectId ? { projectId } : {}),
    ...(cookieBrowsers.length ? { cookieBrowsers } : {}),
  };
  const request = urlValid(params.url) ? toolRequest(status.byId.get('link-import'), 'link', params) : null;
  const key = request ? JSON.stringify(request) : '';
  const starter = useToolStart('link-import', key);
  const block = blockOf(status, 'link-import', 'link', draft.transcribe ? ['transcribe'] : []);
  const needTool = downloader.updating ? FORM_COPY.toolUpdating : FORM_COPY.needTool;
  const why = firstWhy(block && !downloader.ready ? needTool : block,
    !urlValid(params.url) && FORM_COPY.needUrl, !downloader.ready && needTool,
    !!starter.asking && FORM_COPY.needGrant, (!request || cookies.pending) && FORM_COPY.loading);
  const start = () => {
    if (why || !request) return;
    const meta: RunMeta = { tool: 'link-import', input: 'link', title: `${LINK_TOOL_COPY.title} · ${params.url.replace(/^https?:\/\//, '')}`,
      target: 'none', transcribe: draft.transcribe, projectName: projects.find((p) => p.id === projectId)?.name ?? null };
    starter.start(request, meta, key);
  };
  return <ToolFrame tool="link-import" title={LINK_TOOL_COPY.title}
    bar={<SubmitBar why={why} label={draft.transcribe ? LINK_TOOL_COPY.submitTranscribe : LINK_TOOL_COPY.submit} busy={starter.busy} onPress={start} />}
    onKeyDown={submitOnModEnter(start)}>
    <p className={lede}>{LINK_TOOL_COPY.lede}</p>
    <Section>
      <LinkSource url={draft.url} onUrl={(url) => patch({ url })} downloader={downloader}
        downloadDir={downloadDirLabel(downloadSetting ?? null, null)} onChangeDir={() => void changeDownloadDir(runtime)}
        note={LINK_TOOL_COPY.sourceNote}
        tool={<DownloaderSummary view={downloader} cookies={cookieSummary(cookieBrowsers)}
          onSettings={() => useShell.getState().go({ tab: 'settings', section: 'downloader' })} />} />
    </Section>
    <Section>
      <Switch isSelected={draft.transcribe} onChange={(transcribe) => patch({ transcribe })}>{LINK_TOOL_COPY.transcribe}</Switch>
      {draft.transcribe ? <>
        <span className={detail}>{LINK_TOOL_COPY.transcribeNote}</span>
        <Picker label={LINK_TOOL_COPY.project} selectedKey={projectId ?? 'none'} disabledKeys={projects.filter((p) => p.missing).map((p) => p.id)}
          onSelectionChange={(key) => patch({ projectId: key === 'none' ? null : String(key) })}>
          <PickerItem id="none">{LINK_TOOL_COPY.noProject}</PickerItem>
          {projects.map((p) => <PickerItem key={p.id} id={p.id} textValue={p.name}>
            <Text slot="label">{p.name}</Text>
            {p.missing ? <Text slot="description">{S.sidebarRows.folderMissing}</Text> : null}
          </PickerItem>)}
        </Picker>
        {projectId ? <span className={detail}>{LINK_TOOL_COPY.projectNote}</span> : null}
      </> : null}
    </Section>
    {starter.asking ? <GrantCard items={starter.asking} onAgree={starter.agree} busy={starter.busy} /> : null}
  </ToolFrame>;
}
