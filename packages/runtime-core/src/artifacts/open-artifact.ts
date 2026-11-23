// i18n-ignore-file: 日志与给模型的错误是英文；给人看的走 RcArtifacts
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  createHarness,
  installSkill,
  readDaemon,
  runtimeInfo,
  type Harness as OaHarness,
  type HarnessOptions,
  type OpenRequest,
  type WakeAnswer,
} from '@open-artifact/harness-kit';
import { TOOL_DEFINITIONS, type ShellEventParams, type ToolCallResult, type ToolDefinition, type WakeDeliverParams } from '@open-artifact/protocol';
import {
  RpcError,
  SKILL_META_FILE,
  getLocale,
  intlLocale,
  onLocaleChange,
  type ArtifactOpenResult,
  type ArtifactsEvent,
  type ArtifactsSnapshot,
  type Id,
  type RelayBody,
} from '@baocut/protocol';
import { RC_ARTIFACTS_BY_LOCALE, RcArtifacts } from '@baocut/protocol/messages/runtime-core';
import { TopicLog, type Delivery, type DeliveryOutcome, type Harness, type Logger, type RunEvent, type TopicSubscription } from '@baocut/harness';
import { ToolError } from '../agent-tools/tool-catalog.ts';
import type { ArtifactsBackend } from '../agent-tools/artifact-tools.ts';

/**
 * Open Artifact 的接入（docs/design/artifacts §2）：Runtime 是 Open Artifact daemon 的一个适配器，harness 名 `baocut`。
 *
 * - 连接：第一次用到时（工具调用、打开作品）才连，daemon 没在跑就用随应用带的运行时（`@open-artifact/cli`）起一个；
 *   `connectAtStart` 时 Runtime 启动后就在后台连。连上后 daemon 在本机一直跑，别的应用也用它。
 * - 会话：Open Artifact 的 session 就是 BaoCut 的会话 id，workspace 是会话的工作目录。第一次以某个会话调用时 attach，
 *   回合起止报 `running` / `idle`。
 * - 唤醒（§4）：作品页面上发给智能体的评论与请求经 `wake` 回来。所有者本人发的按 `relay` 交给拥有作品的会话（Harness.deliver）；
 *   协作者的不起回合，留在收件箱（`failed`），智能体下次用 `ArtifactComments` 读到。
 * - 打开（§5）：daemon 要给人看一份作品时调 `open`，界面在作品标签里载入 Shell 的一次性地址；界面自己点开的经 `artifacts.open`。
 * - skill（§6）：`/artifacts` 的 SKILL.md 由 Open Artifact 按这个 harness 渲染（连上时用 daemon 的，没连上时用 kit 自带的），
 *   写进 skill 的集成目录。
 */

/** `wake` 的回答里没有 `queued`：held 等回合结束一起带进去，对 daemon 来说就是交到了。 */
const WAKE_STATUS: Record<DeliveryOutcome['result'], WakeAnswer> = {
  steered: 'delivered',
  held: 'delivered',
  woke: 'resumed',
  started: 'resumed',
  dropped: 'failed',
};

/** 界面点开时等 daemon 回调 `open` 的时间。 */
const OPEN_WAIT_MS = 10_000;

export const ARTIFACTS_SKILL_ID = 'artifacts';

/**
 * `/artifacts` 命令（docs/design/artifacts §6）：消息以 `/artifacts` 开头时这一条点选 Open Artifact 的 skill，和在输入框里点选它一样。
 * 界面、CLI 与 Bot 发来的都认；正文原样留着，智能体看得到命令后面写的要求。
 */
export function isArtifactsCommand(text: string): boolean {
  return new RegExp(`^\\s*/${ARTIFACTS_SKILL_ID}(?=\\s|$)`, 'i').test(text);
}

export interface ArtifactsServiceOptions {
  harness: Pick<Harness, 'conversationOf' | 'deliver' | 'onRun' | 'runInfo' | 'recordArtifactCreated'>;
  /** skill 的集成目录（`SkillCatalogOptions.providedDir`）：`/artifacts` 写在 `<dir>/artifacts/`。null 时不写。 */
  skillsDir: string | null;
  /** 写好 skill 之后：会话的 skill 索引要重建。 */
  skillsChanged?: () => void;
  /** 有没有界面在看（桌面端窗口）：没有时 `open` 回答没打开，daemon 自己按设置处理。 */
  hasViewer?: () => boolean;
  /** 随应用带的运行时目录；不给时按 `resolveOpenArtifactRuntime` 找。 */
  runtimeDir?: string | null;
  /** Open Artifact 的 home；不给时是 kit 的默认（`OPEN_ARTIFACT_HOME` 或 `~/.agents/open-artifact`）。测试用。 */
  home?: string;
  /** 测试替身：建连接的函数。 */
  create?: (options: HarnessOptions) => Promise<OaHarness>;
  log: Logger;
}

/**
 * 随应用带的 Open Artifact 运行时（`@open-artifact/cli` 的包目录）：`BAOCUT_OPEN_ARTIFACT_DIR`（桌面端主进程传入）、打包的资源目录
 * `<resources>/open-artifact`，最后是装在 node_modules 里的那一份。都没有时 null（kit 再找本机登记过的运行时）。
 */
export function resolveOpenArtifactRuntime(env: NodeJS.ProcessEnv = process.env): { dir: string; version: string } | null {
  const candidates: string[] = [];
  if (env.BAOCUT_OPEN_ARTIFACT_DIR) candidates.push(env.BAOCUT_OPEN_ARTIFACT_DIR);
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) candidates.push(path.join(resources, 'open-artifact'));
  try {
    candidates.push(path.dirname(createRequire(import.meta.url).resolve('@open-artifact/cli/package.json')));
  } catch {
    // 没装：跳过。
  }
  for (const dir of candidates) {
    const info = fs.existsSync(dir) ? runtimeInfo(dir) : null;
    if (info?.version) return { dir, version: info.version };
  }
  return null;
}

export class ArtifactsService implements ArtifactsBackend {
  readonly topic: TopicLog<ArtifactsSnapshot, ArtifactsEvent>;
  readonly #options: ArtifactsServiceOptions;
  readonly #log: Logger;
  #oa: Promise<OaHarness> | null = null;
  #available = false;
  #error: string | null = null;
  #definitions: readonly ToolDefinition[] = TOOL_DEFINITIONS;
  readonly #attached = new Map<Id, Promise<void>>();
  /** 界面点开（`artifacts.open`）等 daemon 回调 `open` 的那几个，按作品链接。 */
  readonly #pendingOpens = new Map<string, (open: ArtifactOpenResult) => void>();
  readonly #stops: (() => void)[] = [];
  #closed = false;
  #skillEtag: string | null = null;

  constructor(options: ArtifactsServiceOptions) {
    this.#options = options;
    this.#log = options.log;
    this.topic = new TopicLog(() => ({ available: this.#available, error: this.#error }), '0');
    this.#stops.push(options.harness.onRun((event) => this.#onRun(event)));
    this.#stops.push(onLocaleChange(() => void this.#writeSkill()));
  }

  /** 先写一份 kit 自带的 skill（不用连 daemon），之后连上时换成 daemon 渲染的。 */
  async init(): Promise<void> {
    await this.#writeSkill();
  }

  /** Runtime 启动后在后台连：只在本机已经有 daemon 在跑时连，免得每次启动都拉起一个。 */
  connectIfRunning(): void {
    void readDaemon(this.#options.home)
      .then((found) => {
        if (found && !this.#closed) void this.#connect().catch(() => undefined);
      })
      .catch(() => undefined);
  }

  subscribe(afterSeq: string | undefined, listener: (event: never) => void): TopicSubscription<unknown, unknown> {
    return this.topic.subscribe(afterSeq, listener as never) as TopicSubscription<unknown, unknown>;
  }

  definitions(): readonly ToolDefinition[] {
    return this.#definitions;
  }

  async call(name: string, args: Record<string, unknown>, conversationId: Id): Promise<ToolCallResult> {
    const oa = await this.#ready();
    const caller = await this.#attach(oa, conversationId);
    return oa.call(name, args, caller);
  }

  /** 界面点开一份作品（`artifacts.open`）：让 daemon 发一张视图票据过来，等它的 `open` 回调。 */
  async open(url: string, conversationId: Id | null): Promise<ArtifactOpenResult> {
    const oa = await this.#ready().catch((error: unknown) => {
      throw unavailable(error);
    });
    const caller = conversationId ? await this.#attach(oa, conversationId) : undefined;
    const viewUrl = await oa.viewUrl(url).catch(() => null);
    if (!viewUrl) throw new RpcError('not-found', RcArtifacts.notFound(), { code: 'ARTIFACT_NOT_FOUND', url });
    const viaCallback = new Promise<ArtifactOpenResult | null>((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingOpens.delete(url);
        resolve(null);
      }, OPEN_WAIT_MS);
      timer.unref?.();
      this.#pendingOpens.set(url, (open) => {
        clearTimeout(timer);
        this.#pendingOpens.delete(url);
        resolve(open);
      });
    });
    const answer = await oa.open(url, caller).catch((error: unknown) => {
      this.#log.warn('Open Artifact could not open an artifact', { url, error: String(error) });
      return { opened: false };
    });
    if (!answer.opened) this.#pendingOpens.get(url)?.({ url, title: '', type: '', viewUrl, embedUrl: viewUrl, view: '' });
    const open = await viaCallback;
    // 没等到回调（旧 daemon、超时）：退回普通页面地址，Shell 照样能看，只是没有宿主桥。
    return open ?? { url, title: '', type: '', viewUrl, embedUrl: viewUrl, view: '' };
  }

  async shellCommand(view: string, command: Record<string, unknown>): Promise<void> {
    const oa = await this.#ready().catch((error: unknown) => {
      throw unavailable(error);
    });
    try {
      await oa.shellCommand(view, command as never);
    } catch (error) {
      throw new RpcError('not-found', RcArtifacts.viewGone(), { code: 'ARTIFACT_VIEW_GONE', view, reason: String(error) });
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const stop of this.#stops.splice(0)) stop();
    const oa = this.#oa;
    this.#oa = null;
    if (oa) (await oa.catch(() => null))?.close();
  }

  #ready(): Promise<OaHarness> {
    return this.#connect();
  }

  #connect(): Promise<OaHarness> {
    if (this.#closed) return Promise.reject(new ToolError('ARTIFACTS_UNAVAILABLE', 'BaoCut is shutting down'));
    if (!this.#oa) {
      this.#oa = this.#create().then(
        async (oa) => {
          // createHarness 第一次连失败时照样返回，在后台重连：这里要的是真连上。
          try {
            await oa.ready();
          } catch (error) {
            this.#oa = null;
            oa.close();
            throw error;
          }
          return oa;
        },
        (error: unknown) => {
          this.#oa = null;
          throw error;
        },
      );
      this.#oa.catch((error: unknown) => {
        this.#setState(false, errorText(error));
        this.#log.warn('Open Artifact is not available', { error: errorText(error) });
      });
    }
    return this.#oa.catch((error: unknown) => {
      throw new ToolError('ARTIFACTS_UNAVAILABLE', `Open Artifact is not available: ${errorText(error)}`, {
        fix: 'Run `open-artifact doctor` in a terminal, or restart BaoCut.',
      });
    });
  }

  async #create(): Promise<OaHarness> {
    const runtime = this.#options.runtimeDir === undefined ? resolveOpenArtifactRuntime() : this.#options.runtimeDir ? runtimeOf(this.#options.runtimeDir) : null;
    const options: HarnessOptions = {
      harness: 'baocut',
      agentName: 'BaoCut',
      commands: [ARTIFACTS_SKILL_ID],
      caps: { wake: { resume: true }, tools: 'native', library: 'cards' },
      ...(runtime ? { runtime } : {}),
      ...(this.#options.home ? { home: this.#options.home } : {}),
      // 页面放在界面的作品标签里，按顶层视图（view 票据）载入：Shell 与界面的消息经 Runtime 转发，不靠 iframe 的来源。
      embed: { origins: [], mode: 'view', remote: 'deny' },
      wake: (params) => this.#wake(params),
      open: (request) => this.#open(request),
      log: (line) => this.#log.debug(line),
    };
    const oa = await (this.#options.create ?? createHarness)(options);
    this.#stops.push(
      oa.on('state', (state) => {
        this.#setState(state === 'connected', state === 'connected' ? null : this.#error);
        if (state === 'connected') void this.#refresh(oa);
      }),
      oa.on('shell', (event: ShellEventParams) => this.topic.publish({ type: 'artifacts.shell', view: event.view, message: event.event })),
      oa.on('artifact', (report) => {
        if (report.change === 'removed' || !report.session || !this.#options.harness.conversationOf(report.session)) return;
        const taskId = this.#options.harness.runInfo(report.session)?.taskId ?? null;
        this.#options.harness.recordArtifactCreated(report.session, taskId, {
          url: report.artifact.url,
          title: report.artifact.title,
          type: report.artifact.type,
        });
      }),
    );
    if (oa.connected) {
      this.#setState(true, null);
      void this.#refresh(oa);
    }
    return oa;
  }

  /** 连上（或重连）之后：取 daemon 的工具定义，按 daemon 重新渲染 skill。 */
  async #refresh(oa: OaHarness): Promise<void> {
    try {
      this.#definitions = await oa.tools();
    } catch (error) {
      this.#log.debug('Could not read the Open Artifact tool definitions', { error: String(error) });
    }
    await this.#writeSkill(oa);
  }

  async #writeSkill(oa?: OaHarness): Promise<void> {
    const dir = this.#options.skillsDir;
    if (!dir || this.#closed) return;
    const client = oa ?? (this.#oa ? await this.#oa.catch(() => null) : null);
    try {
      const result = await installSkill(client?.connected ? client.client : null, {
        dir,
        command: ARTIFACTS_SKILL_ID,
        agentName: 'BaoCut',
        tools: 'native',
        opens: 'host',
        locale: intlLocale(getLocale()),
        force: true,
      });
      await writeSkillLabels(path.join(dir, ARTIFACTS_SKILL_ID));
      if (result.etag !== this.#skillEtag) {
        this.#skillEtag = result.etag;
        this.#options.skillsChanged?.();
      }
    } catch (error) {
      this.#log.warn('Could not write the /artifacts skill', { error: String(error) });
    }
  }

  #attach(oa: OaHarness, conversationId: Id): Promise<{ session: string; workspace: string }> {
    const conversation = this.#options.harness.conversationOf(conversationId);
    if (!conversation) return Promise.reject(new ToolError('NOT_FOUND', `No such conversation: ${conversationId}`));
    const caller = { session: conversationId, workspace: conversation.cwd };
    let attached = this.#attached.get(conversationId);
    if (!attached) {
      const running = this.#options.harness.runInfo(conversationId) !== null;
      attached = oa
        .attach({ ...caller, title: conversation.title, status: running ? 'running' : 'idle' })
        .then(() => undefined)
        .catch((error: unknown) => {
          this.#attached.delete(conversationId);
          throw error;
        });
      this.#attached.set(conversationId, attached);
    }
    return attached.then(() => caller);
  }

  #onRun(event: RunEvent): void {
    // 没连的不去连：状态只给已经接上的会话报。
    if (!this.#attached.has(event.conversationId) || !this.#oa) return;
    const status = event.type === 'started' ? 'running' : 'idle';
    void this.#oa
      .then((oa) => oa.status({ session: event.conversationId }, status))
      .catch((error: unknown) => this.#log.debug('Could not report the session status to Open Artifact', { error: String(error) }));
  }

  async #wake(params: WakeDeliverParams): Promise<WakeAnswer> {
    const conversationId = params.session;
    if (!conversationId || !this.#options.harness.conversationOf(conversationId)) return 'failed';
    // 只有所有者本人与系统（后台动作结束）的起回合；协作者发的留在收件箱，智能体用 ArtifactComments 读。
    if (params.source.from.kind === 'collaborator') return 'failed';
    const item: RelayBody = {
      direction: 'artifact',
      workItemId: null,
      reportId: null,
      from: { role: 'system', conversationId: null },
      text: params.source.summary || params.text,
      cited: [],
    };
    const delivery: Delivery = {
      id: `oa-${createHash('sha256').update(`${conversationId}\n${params.artifactId}\n${params.text}`).digest('hex').slice(0, 24)}`,
      conversationId,
      item,
      agentText: params.text,
      wake: 'new-task',
      origin: 'relay',
      goal: params.source.summary || undefined,
      unattended: params.source.from.kind !== 'owner',
    };
    try {
      const outcome = await this.#options.harness.deliver(delivery);
      return WAKE_STATUS[outcome.result];
    } catch (error) {
      this.#log.warn('Could not deliver an artifact comment', { conversationId, error: String(error) });
      return 'failed';
    }
  }

  #open(request: OpenRequest): boolean {
    const open: ArtifactOpenResult = {
      url: request.url,
      title: request.title ?? '',
      type: '',
      viewUrl: request.viewUrl,
      embedUrl: request.embedUrl,
      view: request.view ?? '',
    };
    const pending = this.#pendingOpens.get(request.url);
    if (pending) {
      pending(open);
      return true;
    }
    if (this.#options.hasViewer && !this.#options.hasViewer()) return false;
    this.topic.publish({ type: 'artifacts.show', conversationId: request.session && this.#options.harness.conversationOf(request.session) ? request.session : null, open });
    return true;
  }

  #setState(available: boolean, error: string | null): void {
    if (available === this.#available && error === this.#error) return;
    this.#available = available;
    this.#error = error;
    this.topic.publish({ type: 'artifacts.state', available, error });
  }
}

function runtimeOf(dir: string): { dir: string; version: string } | null {
  const version = runtimeInfo(dir)?.version;
  return version ? { dir, version } : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unavailable(error: unknown): RpcError {
  return new RpcError('unsupported', RcArtifacts.unavailableBecause({ reason: errorText(error) }), { code: 'ARTIFACTS_UNAVAILABLE' });
}

/** `/artifacts` 的界面名称与介绍（`SKILL_META_FILE`），每种出货语言一份。 */
async function writeSkillLabels(dir: string): Promise<void> {
  const name: Record<string, string> = {};
  const summary: Record<string, string> = {};
  for (const [locale, messages] of Object.entries(RC_ARTIFACTS_BY_LOCALE)) {
    name[locale] = messages.skillName;
    summary[locale] = messages.skillSummary;
  }
  const text = `${JSON.stringify({ name, summary }, null, 2)}\n`;
  const file = path.join(dir, SKILL_META_FILE);
  if ((await fsp.readFile(file, 'utf8').catch(() => null)) === text) return;
  await fsp.writeFile(file, text);
}
