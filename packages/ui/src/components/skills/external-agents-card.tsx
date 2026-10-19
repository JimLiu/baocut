import { useCallback, useEffect, useState } from 'react';
import {
  RpcError,
  localizeText,
  AGENT_SKILL_HOST_FOLDERS,
  type AgentSkillHostFolder,
  type AgentSkillInstallMode,
  type AgentSkillLocation,
  type AgentSkillStatus,
  type AgentSkillTarget,
} from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Badge,
  Button,
  ButtonGroup,
  Checkbox,
  CheckboxGroup,
  Content,
  Dialog,
  DialogContainer,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  InlineAlert,
  Menu,
  MenuItem,
  MenuTrigger,
  ProgressCircle,
  Radio,
  RadioGroup,
  StatusLight,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Close from '@react-spectrum/s2/icons/Close';
import Copy from '@react-spectrum/s2/icons/Copy';
import Delete from '@react-spectrum/s2/icons/Delete';
import Folder from '@react-spectrum/s2/icons/Folder';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import Link from '@react-spectrum/s2/icons/Link';
import More from '@react-spectrum/s2/icons/More';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  agentSkillOverview,
  cliEntryDir,
  compareVersions,
  pathInDir,
  tildePath,
  userHomeOf,
  cliLinkCommand,
  isInstalled,
  locationAction,
  locationsIn,
  projectAt,
  projectChoices,
  removalDeletesFiles,
  trimSlash,
  type AgentSkillOverview,
} from '../../model/agent-skill-install.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { agentSkillStatus, installAgentSkill, removeAgentSkill } from '../../runtime/skill-commands.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useServices } from '../../state/services-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { CommandBlock, copyText } from '../settings/agent-command-block.tsx';
import { EXTERNAL_COPY } from './skills-copy.ts';

/*
 * 「在终端或其他应用的 Agent 里使用 BaoCut」（Agent 面设计 §8.2；原型 page-settings-skills.jsx `ExternalAgentsCard` 与
 * settings-skill-install.jsx）：Skills 页最上面，默认折叠；折叠条上看得到装在哪、版本是不是最新，有旧的直接「全部更新」。
 * 展开后：一句说明 → App 自带的三样（skill、命令行、MCP 服务）→ 全局 / 指定目录两块安装位置 → 安装方式、怎么确认、命令参考。
 * 状态与写盘都在 Runtime（`agentSkill.*`）；浏览器里只看状态，安装与移除在桌面应用或 CLI 里做。
 */

const C = () => EXTERNAL_COPY;

const card = style({ borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', borderRadius: 'xl', minWidth: 0 });
const bar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 12,
  minWidth: 0,
  paddingY: 12,
  paddingStart: 8,
  paddingEnd: 16,
});
const toggle = style({
  display: 'flex',
  flexGrow: 1,
  flexBasis: 0,
  alignItems: 'center',
  gap: 12,
  minWidth: 240,
  paddingX: 8,
  paddingY: 4,
  borderStyle: 'none',
  borderRadius: 'default',
  backgroundColor: { default: 'transparent', ':hover': 'gray-50' },
  color: 'inherit',
  font: 'ui',
  textAlign: 'start',
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
});
const mark = style({
  display: 'inline-flex',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  size: 32,
  borderRadius: 'default',
  backgroundColor: { default: 'gray-100', isOn: 'green-100' },
  color: { default: 'gray-800', isOn: 'green-1000' },
});
const barText = style({ display: 'flex', flexGrow: 1, flexDirection: 'column', gap: 4, minWidth: 0 });
const barTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const barLine = style({ truncate: true, font: 'ui-xs', color: 'gray-700' });
const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  paddingX: 20,
  paddingBottom: 20,
  paddingTop: 16,
  borderTopWidth: 2,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const lede = style({ margin: 0, font: 'body-sm', color: 'gray-800', maxWidth: '[720px]' });
const block = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
const blockHead = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'start', gap: 8 });
const blockText = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, flexBasis: 0, minWidth: 240 });
const h3 = style({ margin: 0, font: 'title-sm', color: 'gray-900' });
const hint = style({ margin: 0, font: 'ui-xs', color: 'gray-700', maxWidth: '[720px]', overflowWrap: 'anywhere' });
const row = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0, paddingY: 8 });
const rowText = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 240 });
const reader = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const path = style({ font: 'code-xs', color: 'gray-700', overflowWrap: 'anywhere', userSelect: 'text' });
const state = style({
  font: 'ui-xs',
  color: { default: 'gray-600', tone: { positive: 'green-1000', notice: 'orange-1000' } },
});
const stateLine = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, minWidth: 0 });
const stateDetail = style({ font: 'ui-xs', color: 'gray-700', overflowWrap: 'anywhere' });
const group = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  paddingTop: 12,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const groupHead = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const groupName = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0, font: 'ui-sm', color: 'gray-900' });
const empty = style({ margin: 0, padding: 16, borderRadius: 'lg', backgroundColor: 'gray-50', font: 'ui-sm', color: 'gray-700' });
const stack = style({ display: 'flex', flexDirection: 'column', gap: 16 });
const pickRow = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const pickLabel = style({ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 });
const pickName = style({ font: 'ui-sm', fontWeight: 'bold' });
const preLine = style({ whiteSpace: 'pre-line', overflowWrap: 'anywhere' });

type Tone = 'positive' | 'notice';

function errorText(error: unknown): string {
  if (error instanceof RpcError) return localizeText(error.message, error.messageRef) ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

function hostName(folder: AgentSkillHostFolder): string {
  return C().host[folder] ?? folder;
}

/** 折叠条：徽标、一句「装在哪 · 版本」与可选的「全部更新」。 */
function summaryOf(
  ov: AgentSkillOverview,
  version: string,
): { tone: 'neutral' | 'positive' | 'notice'; chip: string; line: string; cta: string | null } {
  const where = [
    ov.globalFolders.length ? C().whereGlobal(ov.globalFolders.map(hostName).join(C().listSeparator)) : null,
    ov.dirCount ? C().whereDirs(ov.dirCount) : null,
  ].filter((x): x is string => !!x);
  const line = (...extra: (string | null)[]) => [...where, ...extra].filter((x): x is string => !!x).join(C().lineSeparator);
  if (ov.kind === 'none') return { tone: 'neutral', chip: C().chipNone, line: C().summaryNone, cta: null };
  if (ov.kind === 'update') {
    const n = ov.fixable.length;
    return ov.stale.length
      ? {
          tone: 'notice',
          chip: C().chipUpdate(n),
          line: line(
            !ov.oldest ? null : compareVersions(ov.oldest, version) < 0 ? C().whereStale(ov.oldest, version) : C().whereChanged(version),
          ),
          cta: C().updateAll(version),
        }
      : { tone: 'notice', chip: C().chipRepair(n), line: line(C().whereBroken), cta: C().repairAll };
  }
  if (ov.kind === 'attention') return { tone: 'notice', chip: C().chipTaken(ov.foreign.length), line: line(`v${version}`), cta: null };
  return { tone: 'positive', chip: C().chipOk(version), line: line(), cta: null };
}

/** 一处位置的状态灯先回答「装没装」，后面一句灰字说怎么装的、为什么要处理。 */
function stateOf(
  l: AgentSkillLocation,
  version: string,
  home: string | null,
): { label: string; light: 'neutral' | 'positive' | 'notice'; detail: string | null } {
  const L = C().status;
  const S = C().state;
  switch (l.state) {
    case 'none':
      return { label: L.none, light: 'neutral', detail: null };
    case 'current':
      return { label: L.installed(l.version ?? version), light: 'positive', detail: l.mode === 'link' ? S.currentLink : S.currentCopy };
    case 'stale':
      if (l.mode === 'link') return { label: L.update(l.version ?? '?'), light: 'notice', detail: S.staleLink(version) };
      return l.version && compareVersions(l.version, version) >= 0
        ? { label: L.changed(l.version), light: 'notice', detail: S.changedCopy }
        : { label: L.update(l.version ?? '?'), light: 'notice', detail: S.staleCopy(version) };
    case 'broken':
      return { label: L.broken, light: 'notice', detail: S.broken(l.linkTarget ? tildePath(l.linkTarget, home) : '?') };
    case 'foreign':
      return { label: L.foreign, light: 'notice', detail: S.foreign };
  }
}

const targetOf = (l: AgentSkillLocation): AgentSkillTarget => ({ root: l.root, folder: l.folder });

export function ExternalAgentsCard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const connected = useConnection((s) => s.state.status === 'connected');
  const [status, setStatus] = useState<AgentSkillStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<AgentSkillInstallMode>('link');
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'link'; locations: AgentSkillLocation[] } | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(() => {
    setError(null);
    agentSkillStatus(runtime).then(setStatus, (e: unknown) => setError(errorText(e)));
  }, [runtime]);

  // 折叠着也要知道装没装、是不是最新：连上就取一次，展开时再取一次（用户可能在外面动过）。
  useEffect(() => {
    if (connected) load();
  }, [connected, load]);
  useEffect(() => {
    if (open && connected) load();
  }, [open, connected, load]);

  const run = async (pending: Promise<AgentSkillStatus>, done: string) => {
    setBusy(true);
    try {
      setStatus(await pending);
      ToastQueue.positive(done, { timeout: 5000 });
    } catch (e) {
      ToastQueue.negative(errorText(e), { timeout: 8000 });
      load();
    } finally {
      setBusy(false);
    }
  };

  const install = (targets: (AgentSkillTarget & { mode: AgentSkillInstallMode })[], done: string) =>
    void run(installAgentSkill(runtime, targets), done);
  const remove = (locations: AgentSkillLocation[]) =>
    void run(removeAgentSkill(runtime, locations.map(targetOf)), C().removed(locations.length));

  const ov = status ? agentSkillOverview(status) : null;
  const sum = status && ov ? summaryOf(ov, status.version ?? '?') : null;
  const updateAll = () => {
    if (!status || !ov) return;
    install(
      ov.fixable.map((l) => ({ ...targetOf(l), mode: l.mode ?? 'link' })),
      ov.stale.length ? C().updated(ov.fixable.length, status.version ?? '?') : C().installed(ov.fixable.length),
    );
  };

  const home = status ? userHomeOf(status) : null;
  const actions: RowActions = {
    web,
    home,
    busy,
    act: (l) => install([{ ...targetOf(l), mode: l.state === 'none' ? mode : (l.mode ?? mode) }], C().installed(1)),
    switchTo: (l, to) => {
      if (to === 'link' && removalDeletesFiles(l)) setConfirm({ kind: 'link', locations: [l] });
      else install([{ ...targetOf(l), mode: to }], C().switched);
    },
    remove: (l) => (removalDeletesFiles(l) ? setConfirm({ kind: 'remove', locations: [l] }) : remove([l])),
    reveal: (p) => void runtime.host.revealPath(p),
  };

  return (
    <section className={card} aria-label={C().title}>
      <div className={bar}>
        <button type="button" className={toggle} aria-expanded={open} onClick={() => onOpenChange(!open)}>
          {open ? <ChevronDown /> : <ChevronRight />}
          <span className={mark({ isOn: ov?.kind === 'ok' })}>
            <Lightbulb />
          </span>
          <span className={barText}>
            <span className={barTitle}>{C().title}</span>
            <span className={barLine}>{sum ? sum.line : error ? C().loadFailed(error) : C().loading}</span>
          </span>
        </button>
        {sum ? (
          <Badge variant={sum.tone} fillStyle="subtle" size="S">
            {sum.chip}
          </Badge>
        ) : null}
        {sum?.cta && !web ? (
          <Button variant="accent" size="S" isPending={busy} onPress={updateAll}>
            {sum.cta}
          </Button>
        ) : null}
        {ov?.kind === 'none' && !open ? (
          <Button variant="secondary" size="S" onPress={() => onOpenChange(true)}>
            {C().installOpen}
          </Button>
        ) : null}
        {error && !status ? (
          <Button variant="secondary" size="S" onPress={load}>
            {C().retry}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className={body}>
          <p className={lede}>{C().lede}</p>
          {web ? (
            <InlineAlert variant="informative">
              <Content>{C().webNote}</Content>
            </InlineAlert>
          ) : null}
          {status ? (
            <>
              <BundledRows status={status} home={home} onReveal={web ? null : actions.reveal} />
              {status.appOutsideApplications ? (
                <InlineAlert variant="notice">
                  <Heading>{C().outsideTitle}</Heading>
                  <Content>{C().outsideBody}</Content>
                </InlineAlert>
              ) : null}
              {ov?.foreign.length ? (
                <InlineAlert variant="notice">
                  <Heading>{C().takenTitle}</Heading>
                  <Content>{C().takenBody}</Content>
                </InlineAlert>
              ) : null}
              <div className={block}>
                <h3 className={h3}>{C().globalTitle}</h3>
                <p className={hint}>{C().globalBody}</p>
                {locationsIn(status, null).map((l) => (
                  <LocationRow key={l.path} location={l} version={status.version ?? '?'} actions={actions} />
                ))}
              </div>
              <div className={block}>
                <div className={blockHead}>
                  <div className={blockText}>
                    <h3 className={h3}>{C().dirsTitle}</h3>
                    <p className={hint}>{C().dirsBody}</p>
                  </div>
                  {web ? null : (
                    <Button variant="secondary" size="S" isDisabled={busy} onPress={() => setPicking(true)}>
                      <Add />
                      <Text>{C().installToDir}</Text>
                    </Button>
                  )}
                </div>
                {status.dirs.length ? (
                  status.dirs.map((dir) => (
                    <DirGroup
                      key={dir}
                      dir={dir}
                      status={status}
                      actions={actions}
                      onAlso={(folder) => install([{ root: dir, folder, mode }], C().installed(1))}
                      onRemoveAll={() => {
                        const mine = locationsIn(status, dir).filter(isInstalled);
                        if (mine.some(removalDeletesFiles)) setConfirm({ kind: 'remove', locations: mine });
                        else if (mine.length) remove(mine);
                      }}
                    />
                  ))
                ) : (
                  <p className={empty}>{C().dirsEmpty}</p>
                )}
              </div>
            </>
          ) : null}
          <ExtraDisclosures mode={mode} onMode={setMode} web={web} />
        </div>
      ) : null}

      {picking && status ? (
        <DirInstallDialog
          mode={mode}
          home={home}
          installed={status.dirs}
          onClose={() => setPicking(false)}
          onInstall={(roots, folders) =>
            install(
              roots.flatMap((root) => folders.map((folder) => ({ root, folder, mode }))),
              C().installed(roots.length * folders.length),
            )
          }
        />
      ) : null}

      <DialogContainer onDismiss={() => setConfirm(null)}>
        {confirm ? (
          <AlertDialog
            variant="destructive"
            title={confirm.kind === 'link' ? C().confirmLinkTitle : C().confirmRemoveTitle}
            primaryActionLabel={confirm.kind === 'link' ? C().confirmLink : C().confirmRemove}
            cancelLabel={C().cancel}
            onPrimaryAction={() =>
              confirm.kind === 'link'
                ? install(
                    confirm.locations.map((l) => ({ ...targetOf(l), mode: 'link' as const })),
                    C().switched,
                  )
                : remove(confirm.locations)
            }>
            <span className={preLine}>
              {(confirm.kind === 'link' ? C().confirmLinkBody : C().confirmRemoveBody)(
                confirm.locations
                  .filter(removalDeletesFiles)
                  .map((l) => l.path)
                  .join('\n'),
              )}
            </span>
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </section>
  );
}

interface RowActions {
  web: boolean;
  /** 用户主目录：路径在它下面时写成 `~/…`。 */
  home: string | null;
  busy: boolean;
  act(location: AgentSkillLocation): void;
  switchTo(location: AgentSkillLocation, mode: AgentSkillInstallMode): void;
  remove(location: AgentSkillLocation): void;
  reveal(path: string): void;
}

/** App 自带的三样：skill 本体、命令行、MCP 服务。都随 App 发布，这里只说在哪、什么版本、开没开。 */
function BundledRows({
  status,
  home,
  onReveal,
}: {
  status: AgentSkillStatus;
  home: string | null;
  onReveal: ((path: string) => void) | null;
}) {
  const go = useShell((s) => s.go);
  const mcp = useServices((s) => (s.ready ? (s.services.find((x) => x.serviceId === 'mcp') ?? null) : null));
  const cli = status.cli;
  const windows = !!cli.entry && (/\.cmd$/i.test(cli.entry) || /^[A-Za-z]:\\/.test(cli.entry));
  const revealButton = (p: string) =>
    onReveal ? (
      <ActionButton isQuiet size="S" aria-label={C().revealOf(p)} onPress={() => onReveal(p)}>
        <FolderOpen />
      </ActionButton>
    ) : null;
  let cliState: { text: string; tone?: Tone };
  if (!cli.entry) cliState = { text: C().cliNoEntry };
  else if (cli.onPath?.fromApp) cliState = { text: C().cliOnPathApp, tone: 'positive' };
  else if (cli.onPath) cliState = { text: C().cliOnPathOther, tone: 'notice' };
  else cliState = { text: windows ? C().cliAddToPath : C().cliNotOnPath, tone: 'notice' };
  const shownCli = cli.onPath
    ? `${tildePath(cli.onPath.path, home)}${cli.onPath.target ? ` → ${tildePath(cli.onPath.target, home)}` : ''}`
    : cli.entry && tildePath(cli.entry, home);
  return (
    <div className={block}>
      <h3 className={h3}>{C().bundledTitle}</h3>
      <p className={hint}>{C().bundledBody}</p>
      <div className={row}>
        <div className={rowText}>
          <span className={reader}>{C().skillName}</span>
          <code className={path}>{tildePath(status.source, home)}</code>
          <span className={state({})}>
            {status.bundled ? C().skillShipped(status.version ?? '?') : C().skillDev(status.version ?? '?')}
          </span>
        </div>
        {revealButton(status.source)}
      </div>
      <div className={row}>
        <div className={rowText}>
          <span className={reader}>{C().cliName}</span>
          {shownCli ? <code className={path}>{shownCli}</code> : null}
          <span className={state({ tone: cliState.tone })}>{cliState.text}</span>
        </div>
        {cli.onPath ? revealButton(cli.onPath.path) : cli.entry ? revealButton(cli.entry) : null}
      </div>
      {cli.entry && !cli.onPath ? (
        <CommandBlock
          value={windows ? cliEntryDir(cli.entry) : cliLinkCommand(cli.entry)}
          copyLabel={windows ? C().pathLabel : C().commandLabel}
        />
      ) : null}
      <div className={row}>
        <div className={rowText}>
          <span className={reader}>{C().mcpName}</span>
          <span className={hint}>{C().mcpBody}</span>
          <StatusLight variant={mcp?.state === 'on' ? 'positive' : 'neutral'} size="S">
            {mcp?.state === 'on' ? C().mcpOn : C().mcpOff}
          </StatusLight>
        </div>
        <Button variant="secondary" size="S" onPress={() => go({ tab: 'services', service: 'mcp' })}>
          {C().mcpOpen}
        </Button>
      </div>
    </div>
  );
}

/** 一处位置：谁会读它 / 路径 / 版本与状态 / 一颗对症的按钮，其余收进行尾菜单。 */
function LocationRow({ location: l, version, actions }: { location: AgentSkillLocation; version: string; actions: RowActions }) {
  const s = stateOf(l, version, actions.home);
  const action = locationAction(l);
  const installed = isInstalled(l);
  return (
    <div className={row}>
      <div className={rowText}>
        <span className={reader}>{hostName(l.folder)}</span>
        <code className={path}>{l.root === null ? tildePath(l.path, actions.home) : pathInDir(l)}</code>
        <span className={stateLine}>
          <StatusLight variant={s.light} size="S">
            {s.label}
          </StatusLight>
          {s.detail ? <span className={stateDetail}>{s.detail}</span> : null}
        </span>
      </div>
      {action && !actions.web ? (
        <Button
          variant="secondary"
          size="S"
          isDisabled={actions.busy}
          aria-label={C().actionOn(C().action[action], l.path)}
          onPress={() => actions.act(l)}>
          {C().action[action]}
        </Button>
      ) : null}
      <MenuTrigger align="end">
        <ActionButton isQuiet size="S" aria-label={C().more(l.path)}>
          <More />
        </ActionButton>
        <Menu
          aria-label={C().more(l.path)}
          disabledKeys={[
            ...(actions.busy ? ['copy', 'link', 'remove'] : []),
            ...(l.state === 'none' || l.state === 'broken' ? ['reveal'] : []),
          ]}
          onAction={(key) => {
            if (key === 'copy') actions.switchTo(l, 'copy');
            else if (key === 'link') actions.switchTo(l, 'link');
            else if (key === 'path') void copyText(l.path, C().pathLabel);
            else if (key === 'reveal') actions.reveal(l.path);
            else if (key === 'remove') actions.remove(l);
          }}>
          {installed && !actions.web && l.mode === 'link' && l.state !== 'broken' ? (
            <MenuItem id="copy" textValue={C().toCopy}>
              <Copy />
              <Text slot="label">{C().toCopy}</Text>
              <Text slot="description">{C().toCopyHint}</Text>
            </MenuItem>
          ) : null}
          {installed && !actions.web && l.mode === 'copy' ? (
            <MenuItem id="link" textValue={C().toLink}>
              <Link />
              <Text slot="label">{C().toLink}</Text>
              <Text slot="description">{C().toLinkHint}</Text>
            </MenuItem>
          ) : null}
          <MenuItem id="path" textValue={C().copyPath}>
            <Copy />
            <Text slot="label">{C().copyPath}</Text>
          </MenuItem>
          {actions.web ? null : (
            <MenuItem id="reveal" textValue={C().reveal}>
              <FolderOpen />
              <Text slot="label">{C().reveal}</Text>
            </MenuItem>
          )}
          {installed && !actions.web ? (
            <MenuItem id="remove" textValue={C().remove}>
              <Delete />
              <Text slot="label">{C().remove}</Text>
              <Text slot="description">{l.mode === 'copy' && l.state !== 'broken' ? C().removeCopyHint : C().removeLinkHint}</Text>
            </MenuItem>
          ) : null}
        </Menu>
      </MenuTrigger>
    </div>
  );
}

/** 一个装过的文件夹：项目名（是 BaoCut 项目时）与路径，菜单里补装给另一个 Agent 或移除这里的安装。 */
function DirGroup({
  dir,
  status,
  actions,
  onAlso,
  onRemoveAll,
}: {
  dir: string;
  status: AgentSkillStatus;
  actions: RowActions;
  onAlso: (folder: AgentSkillHostFolder) => void;
  onRemoveAll: () => void;
}) {
  const project = useDirectory((s) => projectAt(s.projects, dir));
  const locations = locationsIn(status, dir);
  const mine = locations.filter((l) => l.state !== 'none');
  const others = locations.filter((l) => l.state === 'none').map((l) => l.folder);
  const name = project?.name ?? tildePath(dir, actions.home);
  return (
    <div className={group}>
      <div className={groupHead}>
        <Folder />
        <span className={groupName}>
          <b>{name}</b>
          {project ? <code className={path}>{tildePath(dir, actions.home)}</code> : null}
        </span>
        {actions.web ? null : (
          <MenuTrigger align="end">
            <ActionButton isQuiet size="S" aria-label={C().dirMenu(name)} isDisabled={actions.busy}>
              <More />
            </ActionButton>
            <Menu
              aria-label={C().dirMenu(name)}
              onAction={(key) => (key === 'remove' ? onRemoveAll() : onAlso(String(key) as AgentSkillHostFolder))}>
              {[
                ...others.map((folder) => (
                  <MenuItem key={folder} id={folder} textValue={C().alsoFor(hostName(folder))}>
                    <Add />
                    <Text slot="label">{C().alsoFor(hostName(folder))}</Text>
                  </MenuItem>
                )),
                <MenuItem key="remove" id="remove" textValue={C().removeDir}>
                  <Delete />
                  <Text slot="label">{C().removeDir}</Text>
                  <Text slot="description">{C().removeDirHint}</Text>
                </MenuItem>,
              ]}
            </Menu>
          </MenuTrigger>
        )}
      </div>
      {mine.map((l) => (
        <LocationRow key={l.path} location={l} version={status.version ?? '?'} actions={actions} />
      ))}
    </div>
  );
}

/**
 * 「安装到目录」：外部 Agent 不一定在 BaoCut 项目里工作，装到任意文件夹都行。列表 = 最近在用的 BaoCut 项目（默认勾上，
 * 标「当前项目」）+ 其他项目 + 用户用系统的文件夹选择加进来的（加进来就勾上）。已经装过的文件夹在卡片的分组里补装。
 */
function DirInstallDialog({
  mode,
  home,
  installed,
  onClose,
  onInstall,
}: {
  mode: AgentSkillInstallMode;
  home: string | null;
  installed: readonly string[];
  onClose: () => void;
  onInstall: (roots: string[], folders: AgentSkillHostFolder[]) => void;
}) {
  const runtime = useRuntime();
  const all = useDirectory((s) => s.projects);
  const [projects] = useState(() => projectChoices(all, installed));
  const latest = [...all].filter((p) => !p.archived).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))[0] ?? null;
  const current = latest && projects.includes(latest) ? latest : null;
  const [extra, setExtra] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>(() => (current ? [trimSlash(current.path)] : []));
  const [hosts, setHosts] = useState<string[]>([...AGENT_SKILL_HOST_FOLDERS]);

  const add = async () => {
    const dir = await runtime.host.pickDirectory({ title: C().dialog.pickTitle });
    if (!dir) return;
    const root = trimSlash(dir);
    if (!extra.includes(root) && !projects.some((p) => trimSlash(p.path) === root)) setExtra((x) => [...x, root]);
    setPicked((x) => (x.includes(root) ? x : [...x, root]));
  };

  const D = C().dialog;
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        {({ close }) => (
          <>
            <Heading slot="title">{D.title}</Heading>
            <Content>
              <div className={stack}>
                <p className={hint}>{D.body}</p>
                <div className={blockHead}>
                  <span className={reader}>{D.folders}</span>
                  <span className={blockText} />
                  <Button variant="secondary" size="S" onPress={() => void add()}>
                    <FolderOpen />
                    <Text>{D.add}</Text>
                  </Button>
                </div>
                {extra.length || projects.length ? (
                  <CheckboxGroup aria-label={D.folders} value={picked} onChange={setPicked}>
                    {extra.map((root) => (
                      <div key={root} className={pickRow}>
                        <Checkbox value={root}>
                          <span className={pickLabel}>
                            <code className={path}>{tildePath(root, home)}</code>
                          </span>
                        </Checkbox>
                        <ActionButton
                          isQuiet
                          size="S"
                          aria-label={D.removeFromList(root)}
                          onPress={() => {
                            setExtra((x) => x.filter((r) => r !== root));
                            setPicked((x) => x.filter((r) => r !== root));
                          }}>
                          <Close />
                        </ActionButton>
                      </div>
                    ))}
                    {projects.map((p) => (
                      <Checkbox key={p.id} value={trimSlash(p.path)}>
                        <span className={pickLabel}>
                          <span className={pickName}>{p.name}</span>
                          {p === current ? (
                            <Badge variant="informative" fillStyle="subtle" size="S">
                              {D.current}
                            </Badge>
                          ) : null}
                          <code className={path}>{tildePath(p.path, home)}</code>
                        </span>
                      </Checkbox>
                    ))}
                  </CheckboxGroup>
                ) : (
                  <p className={empty}>{D.noProjects}</p>
                )}
                <CheckboxGroup label={D.hosts} orientation="horizontal" value={hosts} onChange={setHosts}>
                  {AGENT_SKILL_HOST_FOLDERS.map((folder) => (
                    <Checkbox key={folder} value={folder}>
                      {hostName(folder)}
                    </Checkbox>
                  ))}
                </CheckboxGroup>
                <p className={hint}>{mode === 'link' ? D.noteLink : D.noteCopy}</p>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {C().cancel}
              </Button>
              <Button
                variant="accent"
                isDisabled={!picked.length || !hosts.length}
                onPress={() => {
                  onInstall(
                    picked,
                    AGENT_SKILL_HOST_FOLDERS.filter((f) => hosts.includes(f)),
                  );
                  close();
                }}>
                {D.install(picked.length)}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

/** 安装方式、怎么确认装好了、命令行参考。 */
function ExtraDisclosures({
  mode,
  onMode,
  web,
}: {
  mode: AgentSkillInstallMode;
  onMode: (mode: AgentSkillInstallMode) => void;
  web: boolean;
}) {
  const M = C().mode;
  return (
    <div>
      {web ? null : (
        <Disclosure isQuiet size="S">
          <DisclosureTitle>
            {C().modeTitle} · {mode === 'link' ? M.link : M.copy}
          </DisclosureTitle>
          <DisclosurePanel>
            <div className={stack}>
              <p className={hint}>{C().modeHint}</p>
              <RadioGroup aria-label={C().modeTitle} value={mode} onChange={(v) => onMode(v as AgentSkillInstallMode)}>
                <Radio value="link" description={M.linkDesc}>
                  {M.link} ({M.linkTag})
                </Radio>
                <Radio value="copy" description={M.copyDesc}>
                  {M.copy}
                </Radio>
              </RadioGroup>
            </div>
          </DisclosurePanel>
        </Disclosure>
      )}
      <Disclosure isQuiet size="S">
        <DisclosureTitle>{C().verifyTitle}</DisclosureTitle>
        <DisclosurePanel>
          <p className={hint}>{C().verifyBody}</p>
        </DisclosurePanel>
      </Disclosure>
      <Disclosure isQuiet size="S" defaultExpanded={web}>
        <DisclosureTitle>{C().commandsTitle}</DisclosureTitle>
        <DisclosurePanel>
          <div className={stack}>
            <p className={hint}>{C().commandsBody}</p>
            {['baocut skill install', 'baocut skill install --dir ~/Projects/video', 'baocut skill status'].map((cmd) => (
              <CommandBlock key={cmd} value={cmd} copyLabel={C().commandLabel} />
            ))}
          </div>
        </DisclosurePanel>
      </Disclosure>
    </div>
  );
}
