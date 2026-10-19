import { useCallback, useId, useState, type ReactNode } from 'react';
import type { Id, ProjectGitStatus } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Button,
  Content,
  CustomDialog,
  DialogContainer,
  Heading,
  InlineAlert,
  ProgressCircle,
  StatusLight,
  Switch,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import Close from '@react-spectrum/s2/icons/Close';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import Settings from '@react-spectrum/s2/icons/Settings';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { localizeText } from '@baocut/protocol';
import { shortenPath } from '../../model/format.ts';
import {
  canCommit,
  canRecheck,
  gitError,
  gitLight,
  inRepo,
  lastCommitText,
  localConfigOf,
  pauseLabel,
  refusalText,
  statusRemedy,
  statusText,
} from '../../model/project-git.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDirectory } from '../../state/directory-store.ts';
import { useProjectSettings } from '../../state/project-settings-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { M as SETTINGS } from '../settings/general-settings-copy.ts';
import { useSaveSettings, useSettingsReady } from '../settings/save-settings.ts';
import { useNow } from '../use-now.ts';
import { PROJECT_SETTINGS_COPY as C } from './project-settings-copy.ts';
import { useAlive, useGitCommit, useProjectGit, type GitNote } from './use-project-git.ts';

/**
 * 项目设置（版本记录设计 §5.3–§5.4、§6；原型 project-git.jsx / project-git.css）：git 一节与项目外素材的说明。
 * 入口是 Home 侧栏的项目菜单与版本记录对话框底部的 git 状态条（project-git-strip.tsx），两处都经 `useProjectSettings.open`。
 *
 * 能做什么按表面分：Web 看状态、「提交到 git」；自动提交（Runtime 的偏好设置，Web 不能改设置）、「初始化 git」与允许本地过滤器
 * （只给桌面界面与 CLI，Runtime 也会拒绝）在 Web 上停用并写明去哪里做。Web 的状态里本来就没有仓库路径与过滤器条目，项目路径也不显示。
 */
export function ProjectSettingsHost() {
  const projectId = useProjectSettings((s) => s.projectId);
  const session = useProjectSettings((s) => s.session);
  const close = useProjectSettings((s) => s.close);
  // DialogContainer 关闭后仍留着上一个子元素（为了退场动画）；按打开次数换 key，每次打开重新读。
  return <DialogContainer onDismiss={close}>{projectId ? <ProjectSettingsDialog key={session} projectId={projectId} onClose={close} /> : null}</DialogContainer>;
}

function ProjectSettingsDialog({ projectId, onClose }: { projectId: Id; onClose(): void }) {
  const titleId = useId();
  const web = useRuntime().host.platform === 'web';
  const project = useDirectory((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const sub = [project?.name, !web && project ? shortenPath(project.path) : null].filter(Boolean).join(' · ');
  return (
    <CustomDialog size="L" padding="none" isDismissible aria-labelledby={titleId}>
      <div className={`${shell} bc-no-drag`}>
        <header className={head}>
          <span className={mark}>
            <Settings />
          </span>
          <div className={headText}>
            <h2 id={titleId} className={headTitle}>
              {C.title}
            </h2>
            {sub ? (
              <span className={headSub} title={sub}>
                {sub}
              </span>
            ) : null}
          </div>
          <span className={grow} />
          <TooltipTrigger>
            <ActionButton isQuiet aria-label={C.close} onPress={onClose}>
              <Close />
            </ActionButton>
            <Tooltip>{C.close}</Tooltip>
          </TooltipTrigger>
        </header>
        <div className={`${body} bc-scroll`}>
          <GitSection projectId={projectId} projectPath={project?.path ?? null} web={web} />
          <section className={section} aria-labelledby={`${titleId}-outside`}>
            <h3 id={`${titleId}-outside`} className={sectionTitle}>
              {C.outsideHeading}
            </h3>
            <p className={sectionLead}>{C.outsideLead}</p>
          </section>
        </div>
        <footer className={foot}>
          <Button variant="accent" onPress={onClose}>
            {C.done}
          </Button>
        </footer>
      </div>
    </CustomDialog>
  );
}

/* ---------- git 一节 ---------- */

type Busy = 'init' | 'allow' | 'recheck' | null;

function GitSection({ projectId, projectPath, web }: { projectId: Id; projectPath: string | null; web: boolean }) {
  const runtime = useRuntime();
  const headingId = useId();
  const now = useNow(30_000);
  const { status, loadError, reload } = useProjectGit(projectId);
  const [note, setNote] = useState<GitNote | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [askInit, setAskInit] = useState(false);
  const alive = useAlive();
  const committing = useGitCommit(projectId, setNote);

  const act = useCallback(
    async (kind: Exclude<Busy, null>, task: () => Promise<GitNote | null>, failTitle: string) => {
      setBusy(kind);
      try {
        const next = await task();
        if (alive.current) setNote(next);
      } catch (error) {
        const reason = gitError(error);
        if (reason.status) useProjectSettings.getState().put(reason.status);
        if (alive.current) setNote({ tone: 'negative', title: failTitle, text: reason.message });
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [alive],
  );

  const recheck = (before: ProjectGitStatus) =>
    void act(
      'recheck',
      async () => {
        let next: ProjectGitStatus;
        try {
          next = await reload();
        } catch (error) {
          return { tone: 'negative', title: C.loadFailed(gitError(error).message), text: '' };
        }
        if (next.state === 'ready' && before.state !== 'ready') return { tone: 'positive', title: C.recheckReadyTitle, text: C.recheckReadyText };
        if (next.state === before.state) return { tone: 'informative', title: C.recheckSame, text: statusRemedy(next) ?? '' };
        return null;
      },
      C.checkAgain,
    );
  const allow = (digest: string) =>
    void act(
      'allow',
      async () => {
        const { status: next } = await runtime.client.request('projects.git.allowLocalConfig', { projectId, digest });
        useProjectSettings.getState().put(next);
        return { tone: 'positive', title: C.allowedTitle, text: C.allowedText };
      },
      C.allowFailed,
    );
  const init = () =>
    void act(
      'init',
      async () => {
        const { status: next } = await runtime.client.request('projects.git.init', { projectId });
        useProjectSettings.getState().put(next);
        return { tone: 'positive', title: C.initDoneTitle, text: C.initDoneText };
      },
      C.initFailed,
    );

  return (
    <section className={section} aria-labelledby={headingId}>
      <h3 id={headingId} className={sectionTitle}>
        {C.gitHeading}
      </h3>
      <p className={sectionLead}>{C.gitLead}</p>
      {status ? (
        <>
          <StatusLine status={status} busy={busy === 'recheck'} onRecheck={() => recheck(status)} />
          {/* 上次打开时记下的状态先显示出来；这次没读到时说明一句，免得把旧状态当成现在的。 */}
          {loadError ? (
            <InlineAlert variant="negative" styles={alert}>
              <Content>{C.loadFailed(loadError)}</Content>
            </InlineAlert>
          ) : null}
          <StateAlert status={status} web={web} busy={busy === 'allow'} onAllow={allow} />
          {note ? (
            <InlineAlert variant={note.tone} styles={alert}>
              <Heading>{note.title}</Heading>
              {note.text ? <Content>{note.text}</Content> : null}
            </InlineAlert>
          ) : null}
          {inRepo(status) ? (
            <div>
              <CommitRow status={status} now={now} busy={committing.busy} onCommit={committing.commit} />
              <AutoCommitRow web={web} />
            </div>
          ) : status.state === 'not-repo' ? (
            <div>
              <InitRow status={status} web={web} busy={busy === 'init'} onInit={() => setAskInit(true)} />
            </div>
          ) : null}
        </>
      ) : loadError ? (
        <InlineAlert variant="negative" styles={alert}>
          <Content>{C.loadFailed(loadError)}</Content>
        </InlineAlert>
      ) : (
        <div className={loading}>
          <ProgressCircle size="S" isIndeterminate aria-label={C.loading} />
        </div>
      )}
      <DialogContainer onDismiss={() => setAskInit(false)}>
        {askInit ? (
          <AlertDialog
            variant="confirmation"
            title={C.initConfirmTitle}
            primaryActionLabel={C.initTitle}
            cancelLabel={C.cancel}
            onPrimaryAction={init}>
            {C.initConfirmBody(projectPath ? shortenPath(projectPath) : '')}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </section>
  );
}

/** 状态灯、分支、git 版本与仓库位置（Web 没有），暂停或出错时的「重新检查」。 */
function StatusLine({ status, busy, onRecheck }: { status: ProjectGitStatus; busy: boolean; onRecheck(): void }) {
  const light = gitLight(status);
  return (
    <div className={statusRow}>
      <StatusLight variant={light.tone} size="M">
        {light.label}
      </StatusLight>
      <span className={facts}>
        {status.branch ? <span>{C.branch(status.branch)}</span> : null}
        {status.gitVersion ? <span>{C.gitVersion(status.gitVersion)}</span> : null}
        {status.repoRoot ? (
          <span className={factPath} title={status.repoRoot}>
            {shortenPath(status.repoRoot)}
          </span>
        ) : null}
      </span>
      <span className={grow} />
      {canRecheck(status) ? (
        <ActionButton size="S" isQuiet isDisabled={busy} onPress={onRecheck}>
          <Refresh />
          <Text>{C.checkAgain}</Text>
        </ActionButton>
      ) : null}
    </div>
  );
}

/** 暂停、出错、没有 git 时的说明；本地过滤器暂停时在桌面应用里列出条目、给「允许」。 */
function StateAlert({ status, web, busy, onAllow }: { status: ProjectGitStatus; web: boolean; busy: boolean; onAllow(digest: string): void }) {
  const local = localConfigOf(status);
  if (local) {
    const entries = web ? undefined : local.entries;
    return (
      <InlineAlert variant="notice" styles={alert}>
        <Heading>{C.pausedHeading(pauseLabel(status.pause))}</Heading>
        <Content>
          <span className={para}>{statusText(status, false)}</span>
          {entries?.length ? (
            <>
              <table className={entriesTable}>
                <thead>
                  <tr>
                    <th className={entriesHead({ isKey: true })}>{C.lcEntry}</th>
                    <th className={entriesHead({})}>{C.lcValue}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={`${entry.file ?? ''}\n${entry.key}\n${entry.value}`}>
                      <td className={entriesCell}>
                        <span className={mono}>{entry.key}</span>
                      </td>
                      <td className={entriesCell}>
                        <span className={mono}>{entry.value}</span>
                        {entry.file ? <span className={entriesFile}>{shortenPath(entry.file)}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <span className={para}>{C.lcExplain}</span>
              <span className={alertActs}>
                <Button variant="accent" isPending={busy} onPress={() => onAllow(local.digest)}>
                  {C.allow}
                </Button>
              </span>
            </>
          ) : (
            <span className={para}>{C.lcWeb}</span>
          )}
        </Content>
      </InlineAlert>
    );
  }
  if (status.state === 'paused') {
    return (
      <InlineAlert variant="notice" styles={alert}>
        <Heading>{C.pausedHeading(pauseLabel(status.pause))}</Heading>
        <Content>
          <span className={para}>{statusText(status)}</span>
          <span className={para}>{C.pausedNote}</span>
        </Content>
      </InlineAlert>
    );
  }
  if (status.state === 'error' || status.state === 'unavailable') {
    return (
      <InlineAlert variant={status.state === 'error' ? 'negative' : 'neutral'} styles={alert}>
        <Heading>{status.state === 'error' ? C.errorHeading : C.unavailableHeading}</Heading>
        <Content>
          <span className={para}>{statusText(status)}</span>
        </Content>
      </InlineAlert>
    );
  }
  return null;
}

function CommitRow({ status, now, busy, onCommit }: { status: ProjectGitStatus; now: number; busy: boolean; onCommit(): void }) {
  const maxMiB = useSetting('versions.git.maxFileMiB') ?? 50;
  const lastError = status.lastError && status.state !== 'error' ? C.lastFailed(localizeText(status.lastError.message, status.lastError.messageRef)) : null;
  const line = [lastCommitText(status.lastCommit, now), lastError].filter(Boolean).join(' · ');
  return (
    <Row title={C.commit} desc={C.commitDesc(maxMiB)} note={line || null}>
      <Button variant="secondary" isDisabled={!canCommit(status)} isPending={busy} onPress={onCommit}>
        {C.commit}
      </Button>
    </Row>
  );
}

/** 自动提交是 Runtime 的偏好设置 `versions.git.autoCommit`，这台电脑上的项目共用；Web 不能改设置（`settings.set` 不开放）。 */
function AutoCommitRow({ web }: { web: boolean }) {
  const save = useSaveSettings();
  const ready = useSettingsReady();
  const on = useSetting('versions.git.autoCommit') ?? false;
  return (
    <Row title={C.autoCommit} desc={C.autoCommitDesc} note={web ? SETTINGS.webNote : null}>
      <Switch aria-label={C.autoCommit} isSelected={on} isDisabled={web || !ready} onChange={(next) => void save({ 'versions.git.autoCommit': next })} />
    </Row>
  );
}

function InitRow({ status, web, busy, onInit }: { status: ProjectGitStatus; web: boolean; busy: boolean; onInit(): void }) {
  if (!status.init?.allowed) {
    const why = refusalText(status.init?.refusal) ?? statusText(status, false) ?? '';
    return <Row title={C.initTitle} desc={C.initRefused(why)} note={C.initRefusedNote} />;
  }
  return (
    <Row title={C.initTitle} desc={C.initDesc} note={web ? C.initWebNote : null}>
      <Button variant="secondary" isDisabled={web} isPending={busy} onPress={onInit}>
        {C.initTitle}
      </Button>
    </Row>
  );
}

/** 一行：标题、说明、置灰的原因或补充（信息图标），右边是控件；窄屏控件换到下面。 */
function Row({ title, desc, note, children }: { title: string; desc: string; note: string | null; children?: ReactNode }) {
  return (
    <div className={row}>
      <div className={rowText}>
        <strong className={rowTitle}>{title}</strong>
        <span>{desc}</span>
        {note ? (
          <span className={rowNote}>
            <InfoCircle />
            <span>{note}</span>
          </span>
        ) : null}
      </div>
      {children ? <div className={rowControl}>{children}</div> : null}
    </div>
  );
}

/* ---------- 样式（原型 project-git.css） ---------- */

const NARROW = '@media (max-width: 720px)';

/** 标题与按钮固定，中间滚动；高度跟 S2 弹层的 max-height 90% 对齐。 */
const shell = style({
  display: 'flex',
  flexDirection: 'column',
  width: 'full',
  maxHeight: '[min(760px, 90dvh)]',
  minHeight: 0,
  backgroundColor: 'gray-25',
  color: 'gray-800',
});
const head = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexShrink: 0,
  paddingY: 16,
  paddingStart: { default: 24, [NARROW]: 16 },
  paddingEnd: 16,
  borderWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const mark = style({
  display: { default: 'grid', [NARROW]: 'none' },
  placeItems: 'center',
  flexShrink: 0,
  size: 32,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
  color: 'gray-800',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const headText = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
const headTitle = style({ margin: 0, fontFamily: 'sans', fontSize: 'ui-lg', fontWeight: 'extra-bold', color: 'gray-900' });
const headSub = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const grow = style({ flexGrow: 1 });
const body = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingTop: { default: 8, [NARROW]: 4 }, paddingBottom: { default: 24, [NARROW]: 16 }, paddingX: { default: 24, [NARROW]: 16 } });
const foot = style({
  display: 'flex',
  justifyContent: 'end',
  flexShrink: 0,
  paddingY: 12,
  paddingX: { default: 24, [NARROW]: 16 },
  borderWidth: 0,
  borderTopWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});

const section = style({
  paddingY: 16,
  borderWidth: 0,
  borderTopWidth: { default: 1, ':first-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const sectionTitle = style({ margin: 0, font: 'title-sm', color: 'gray-900' });
const sectionLead = style({ marginTop: 4, marginBottom: 0, font: 'ui', lineHeight: '[1.5]', color: 'gray-700' });

const statusRow = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 16, rowGap: 4, marginTop: 12 });
const facts = style({ display: 'flex', flexWrap: 'wrap', columnGap: 12, rowGap: 4, minWidth: 0, font: 'ui-xs', color: 'gray-600' });
const mono = style({ font: 'code-xs' });
const factPath = style({ font: 'code-xs', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'full' });
const loading = style({ display: 'flex', marginTop: 12 });

const alert = style({ marginTop: 12 });
const para = style({ display: 'block', marginTop: { default: 8, ':first-child': 0 } });
const alertActs = style({ display: 'flex', justifyContent: 'end', marginTop: 12 });
const entriesTable = style({ width: 'full', marginTop: 8, borderCollapse: 'collapse', tableLayout: 'fixed', font: 'ui-xs' });
const entriesHead = style<{ isKey?: boolean }>({
  width: { default: 'auto', isKey: '[36%]' },
  paddingY: 4,
  paddingX: 8,
  textAlign: 'start',
  fontWeight: 'bold',
  color: 'gray-700',
  borderWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-300',
});
const entriesCell = style({
  paddingY: 8,
  paddingX: 8,
  verticalAlign: 'top',
  overflowWrap: 'anywhere',
  color: 'gray-900',
  borderWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const entriesFile = style({ display: 'block', marginTop: 2, color: 'gray-600' });

const row = style({
  display: 'flex',
  flexDirection: { default: 'row', [NARROW]: 'column' },
  alignItems: 'start',
  gap: { default: 16, [NARROW]: 8 },
  paddingTop: 12,
  marginTop: { default: 12, ':first-child': 0 },
  borderWidth: 0,
  borderTopWidth: { default: 1, ':first-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const rowText = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0, font: 'ui-xs', lineHeight: '[1.5]', color: 'gray-700' });
const rowTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const rowNote = style({
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  marginTop: 4,
  color: 'gray-600',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const rowControl = style({ flexShrink: 0, paddingTop: 2 });
