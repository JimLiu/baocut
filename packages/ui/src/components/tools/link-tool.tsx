import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { ActionButton, Checkbox, Picker, PickerItem, Switch, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { CookieBrowserInfo, LinkCookieBrowser } from '@baocut/protocol';
import { allBrowsersState, cookieNotes, NO_COOKIE_BROWSERS, orderedBrowsers, toggleAllBrowsers, toggleBrowser } from '../../model/link-cookies.ts';
import { downloadDirLabel } from '../../model/link-import.ts';
import { urlValid } from '../../model/new-flow.ts';
import { toolRequest, type RunMeta } from '../../model/tool-runs.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDirectory } from '../../state/directory-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { changeDownloadDir, useDownloaderTool } from '../start/downloader-card.tsx';
import { LinkSource } from '../start/flow-media.tsx';
import { GrantCard, ToolFrame } from './tool-run-view.tsx';
import { detail, Section, submitOnModEnter } from './tool-parts.tsx';
import { FORM_COPY, LINK_TOOL_COPY } from './tools-copy.ts';
import { blockOf, useToolStatus } from './use-tool-status.ts';
import { useToolStart, useVideoTools, type LinkDraft } from './use-video-tools.ts';
import { firstWhy, lede, SubmitBar, useRefreshWhenReady } from './video-tool-parts.tsx';

/**
 * 本机检测到的浏览器（`externalTools.cookieBrowsers`）：进下载视频时检测一次，「重新检测浏览器」再检测。
 * Web 服务不开放 `externalTools.*`，浏览器里不检测、也不显示「网站登录」。
 */
interface CookieBrowsersState {
  state: 'idle' | 'checking' | 'done' | 'failed';
  /** Runtime 所在主机的平台：系统授权的提示看它。 */
  platform: string | null;
  browsers: CookieBrowserInfo[];
  error: string | null;
}

const useCookieBrowsers = create<CookieBrowsersState>()(() => ({ state: 'idle', platform: null, browsers: [], error: null }));

function useDetectedBrowsers(enabled: boolean): CookieBrowsersState & { detect(announce: boolean): void } {
  const runtime = useRuntime();
  const state = useCookieBrowsers();
  const detect = useCallback(
    (announce: boolean) => {
      useCookieBrowsers.setState({ state: 'checking' });
      runtime.cookieBrowsers().then(
        ({ platform, browsers }) => {
          useCookieBrowsers.setState({ state: 'done', platform, browsers, error: null });
          if (announce) ToastQueue.neutral(LINK_TOOL_COPY.detected(browsers.length), { timeout: 4000 });
        },
        (error: unknown) => useCookieBrowsers.setState({ state: 'failed', browsers: [], error: error instanceof Error ? error.message : String(error) }),
      );
    },
    [runtime],
  );
  useEffect(() => {
    if (enabled && useCookieBrowsers.getState().state === 'idle') detect(false);
  }, [enabled, detect]);
  return { ...state, detect };
}

const browserRow = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 4, minWidth: 0 });

/** 「网站登录」：只列出检测到的浏览器，最前面是「所有浏览器」（全选 / 半选）；都不勾是匿名下载。 */
function CookieSection({ checked, onChange, detected }: {
  checked: LinkCookieBrowser[];
  onChange(next: LinkCookieBrowser[]): void;
  detected: ReturnType<typeof useDetectedBrowsers>;
}) {
  const list = orderedBrowsers(checked, detected.browsers);
  const all = allBrowsersState(list, detected.browsers);
  const checking = detected.state === 'checking' || detected.state === 'idle';
  const first = checking && !detected.browsers.length;
  return <Section title={LINK_TOOL_COPY.cookies}
    aside={<ActionButton isQuiet size="S" isDisabled={checking} onPress={() => detected.detect(true)}>{checking ? LINK_TOOL_COPY.detecting : LINK_TOOL_COPY.redetect}</ActionButton>}>
    {first ? <span className={detail}>{LINK_TOOL_COPY.detectingFirst}</span>
      : detected.state === 'failed' ? <span className={detail}>{LINK_TOOL_COPY.detectFailed(detected.error)}</span>
        : !detected.browsers.length ? <span className={detail}>{NO_COOKIE_BROWSERS}</span>
          : <>
            <div className={browserRow} role="group" aria-label={LINK_TOOL_COPY.browsersLabel}>
              <Checkbox size="S" isSelected={all.selected} isIndeterminate={all.indeterminate} onChange={() => onChange(toggleAllBrowsers(list, detected.browsers))}>{LINK_TOOL_COPY.allBrowsers}</Checkbox>
              {detected.browsers.map((b) => <Checkbox key={b.id} size="S" isSelected={list.includes(b.id)} onChange={(on) => onChange(toggleBrowser(list, b.id, on, detected.browsers))}>{b.label}</Checkbox>)}
            </div>
            {cookieNotes(list, detected.platform).map((line) => <span key={line} className={detail}>{line}</span>)}
          </>}
  </Section>;
}

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
  const web = runtime.host.platform === 'web';
  const detected = useDetectedBrowsers(!web);
  const cookieBrowsers = orderedBrowsers(draft.cookieBrowsers, detected.browsers);
  const projectId = draft.transcribe && projects.some((p) => p.id === draft.projectId) ? draft.projectId : null;
  const params = {
    url: draft.url.trim(), transcribe: draft.transcribe,
    ...(projectId ? { projectId } : {}),
    ...(cookieBrowsers.length ? { cookieBrowsers } : {}),
  };
  const request = urlValid(params.url) ? toolRequest(status.byId.get('link-import'), 'link', params) : null;
  const key = request ? JSON.stringify(request) : '';
  const starter = useToolStart('link-import', key);
  const block = blockOf(status, 'link-import', 'link');
  const needTool = downloader.updating ? FORM_COPY.toolUpdating : FORM_COPY.needTool;
  const why = firstWhy(block && !downloader.ready ? needTool : block,
    !urlValid(params.url) && FORM_COPY.needUrl, !downloader.ready && needTool,
    !!starter.asking && FORM_COPY.needGrant, !request && FORM_COPY.loading);
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
        note={LINK_TOOL_COPY.sourceNote} />
    </Section>
    {web ? null : <CookieSection checked={draft.cookieBrowsers} onChange={(next) => patch({ cookieBrowsers: next })} detected={detected} />}
    <Section>
      <Switch isSelected={draft.transcribe} onChange={(transcribe) => patch({ transcribe })}>{LINK_TOOL_COPY.transcribe}</Switch>
      {draft.transcribe ? <>
        <span className={detail}>{LINK_TOOL_COPY.transcribeNote}</span>
        <Picker label={LINK_TOOL_COPY.project} selectedKey={projectId ?? 'none'} onSelectionChange={(key) => patch({ projectId: key === 'none' ? null : String(key) })}>
          <PickerItem id="none">{LINK_TOOL_COPY.noProject}</PickerItem>
          {projects.map((p) => <PickerItem key={p.id} id={p.id}>{p.name}</PickerItem>)}
        </Picker>
        {projectId ? <span className={detail}>{LINK_TOOL_COPY.projectNote}</span> : null}
      </> : null}
    </Section>
    {starter.asking ? <GrantCard items={starter.asking} onAgree={starter.agree} busy={starter.busy} /> : null}
  </ToolFrame>;
}
