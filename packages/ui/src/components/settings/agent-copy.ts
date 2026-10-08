import { defineMessages, live, type AgentPolicy } from '@baocut/protocol';
import { revealLabel } from '../../copy.ts';
import { zhHans } from './agent-copy.zh-Hans.ts';
import { zhHant } from './agent-copy.zh-Hant.ts';
import { ja } from './agent-copy.ja.ts';
import { ko } from './agent-copy.ko.ts';
import { es } from './agent-copy.es.ts';
import { fr } from './agent-copy.fr.ts';
import { de } from './agent-copy.de.ts';
import { nl } from './agent-copy.nl.ts';
import { ptBR } from './agent-copy.pt-BR.ts';
import { it } from './agent-copy.it.ts';
import { ru } from './agent-copy.ru.ts';
import { pl } from './agent-copy.pl.ts';
import { tr } from './agent-copy.tr.ts';
import { vi } from './agent-copy.vi.ts';

/**
 * 设置 › Agent 提供方、Skills 与隐私页里 Agent 权限的文案（设计稿 designs/baocut/app/page-settings-agent.jsx、settings-agent-provider.jsx、
 * page-settings-skills.jsx，data.js `agent.policy`）。访问模式四档的名字与说明在 `copy.ts`，与输入框共用。
 * 英文是键与类型的来源，译文在 `agent-copy.<语言>.ts`；读文字要在渲染或调用时读。
 */
const en = {
  /** 页标题（设计稿 page-settings-agent.jsx 的 h1）。 */
  pageTitle: 'Agent providers',
  /** 页标题下三条事实那一列的无障碍名。 */
  factsLabel: 'How Agents work',
  /** 隐私页里「Agent 权限」小标题（page-settings.jsx 的 `setpage__perm`）。 */
  permissionsTitle: 'Agent permissions',
  lede: 'An Agent is an AI coding assistant installed on your computer, such as Claude Code or Codex. BaoCut calls it directly, so a single sentence can get transcribing, translating and editing done.',
  /** 三条事实（page-settings-agent.jsx:12-16）。 */
  facts: [
    { key: 'cli', title: 'Uses what you already have', body: "BaoCut calls the command-line Agent on this computer instead of installing its own." },
    { key: 'plan', title: 'Uses your own subscription', body: 'No extra payment to BaoCut, and no API key to fill in.' },
    { key: 'ask', title: 'Asks before changing anything', body: 'It stops and waits for your OK before writing to a video, and you can undo at any time.' },
  ] as readonly { key: 'cli' | 'plan' | 'ask'; title: string; body: string }[],

  providersHeading: 'Agents on this computer',
  providersHint:
    "BaoCut finds the ones already installed. One working Agent is enough; you don't need them all. If unsure, pick Claude Code or Codex. Built-in ones can only be disabled; ones you added can be removed.",
  /** 列表底下那一行：几时检查过、内置几家、添加了几家、检测到几家（page-settings-agent.jsx 的 `agset-meta`）。 */
  providersMeta: (checked: string | null, builtin: number, added: number, found: number) =>
    `${checked ? `Checked ${checked} · ` : ''}BaoCut has ${builtin} built-in ${builtin === 1 ? 'Agent' : 'Agents'}${added ? `, you added ${added}` : ''}; ${found} detected on this computer`,
  /** 状态区的无障碍名。 */
  statusLabel: 'Agent status',
  scanDone: (n: number) => (n ? `Check complete · ${n} ${n === 1 ? 'Agent' : 'Agents'} on this computer` : 'Check complete · No installed Agents found'),
  scanFailed: (message: string) => `Couldn't check again: ${message}`,
  enableFailed: (message: string) => `Couldn't enable: ${message}`,
  scanning: 'Checking…',
  rescan: 'Check again',
  emptyDisconnected: 'Connect to the Runtime to check for Agents on this computer.',
  emptyNoDrivers: "This version of the Runtime doesn't include any Agents.",
  emptyNoneFound: 'No Agents detected on this computer; the common ones are listed below.',
  scanProgress: 'Checking for Agents',
  faqLabel: 'FAQ',
  goCloudModels: 'Go to cloud models',
  goSkills: 'Go to Skills',

  /** 「更多」折叠段（page-settings-agent.jsx）：没检测到的四家 ACP 智能体收在这里。 */
  moreProviders: {
    title: (count: number) => `Other supported Agents · ${count}`,
    sub: (names: string) => `${names} · None detected on this computer`,
    expand: 'Show',
    collapse: 'Hide',
  },

  /** 「没有逐次询问的通道」的那几家（data.js 的 `FULL_ONLY`）：`capabilities.approvals` 为 false。 */
  fullAccessOnly:
    "It has no way to ask for approval step by step, so BaoCut can only run it in Full access mode: it won't ask you before running commands or changing files.",

  /** `tested` 为 false 的 Agent：能开会话，但没在 BaoCut 里真机跑通过完整会话。 */
  untested: {
    badge: 'Not tested in BaoCut',
    body: "This one hasn't completed a full session in BaoCut on a real machine. Detection, sign-in and the model list work as usual; for problems during a session, follow its own documentation.",
  },

  /** 添加更多 Agent（settings-agent-catalog.jsx，产品设计 §7.6）。 */
  catalog: {
    heading: 'Add more Agents',
    hint: "Other command-line Agents that support ACP (Agent Client Protocol) can be added too. BaoCut hasn't verified them one by one; whether they work depends on the check result.",
    custom: 'Custom command…',
    search: 'Search Agents to add',
    searchPlaceholder: 'Search by name, description or command',
    count: (total: number) => `${total} in the catalog`,
    found: (n: number) => `${n} found`,
    list: 'Agents you can add',
    add: 'Add',
    addTo: (name: string) => `Add ${name}`,
    added: 'Added',
    empty: (query: string) => `Nothing in the catalog matches “${query}”. For an Agent that isn't listed, add it by entering its launch command.`,
    landed: (name: string, custom: boolean) => `Added ${name}${custom ? ' (custom command)' : ''} · Once detected, it can be used in sessions`,
    addFailed: (message: string) => `Couldn't add: ${message}`,
    webNote:
      "Agents can't be added or removed in the browser because this decides which commands run on this computer. Use the BaoCut desktop app instead.",
  },

  /** 自定义命令对话框（settings-agent-catalog.jsx 的 `AgentCustomDialog`）。 */
  customDialog: {
    title: 'Add an Agent with a custom command',
    lede: 'Enter the command that starts it in ACP mode in a terminal. BaoCut starts the program directly, without a terminal.',
    name: 'Name',
    namePlaceholder: 'e.g. My Agent',
    id: 'id',
    idPlaceholder: 'my-agent',
    idHint: 'Identifies this Agent in settings and diagnostics: start with a lowercase letter and use only lowercase letters, digits and hyphens.',
    command: 'Command',
    commandPlaceholder: 'my-agent --acp',
    commandHint: 'Split into a program and arguments at spaces; quote arguments that contain spaces.',
    commandParts: (exe: string, args: string[]) => `Will start as: program ${exe}, arguments ${args.join(' · ')}`,
    env: 'Environment variables (optional)',
    envPlaceholder: 'MY_AGENT_TOKEN_FILE=~/.config/my-agent/token\nMY_AGENT_LOG=0',
    envHint: 'One KEY=VALUE per line, added only when BaoCut starts it.',
    note: "After adding it, BaoCut checks whether it starts, whether it needs signing in, and which models it has. It appears in sessions once it's detected.",
    cancel: 'Cancel',
    submit: 'Add',
    exists: (id: string) => `An Agent already uses “${id}”. Choose another id.`,
  },

  /** 用户添加的那一家的卡片（settings-agent-provider.jsx 的 `AddedInstallPanel` 与详情）。 */
  added: {
    chip: 'Added by you',
    detect: 'Check',
    detecting: 'Checking…',
    remove: 'Remove',
    subFound: (version: string | null) => ['Detected', version ? `v${version}` : null, 'Connected via ACP'].filter(Boolean).join(' · '),
    subLauncher: (launcher: string, needs: string) => `Not checked yet · ${launcher} downloads it at launch; requires ${needs}`,
    subMissing: (command: string) => `Not checked yet · ${command} not found on this computer`,
    note: (name: string) =>
      `${name} connects via ACP (Agent Client Protocol). BaoCut hasn't verified it: for how to install it and which account to sign in with, follow its own documentation.`,
    noInstall: 'No separate install needed',
    noInstallBody: (launcher: string, spec: string, needs: string) =>
      `When BaoCut starts it, ${launcher} downloads ${spec} automatically. Requires ${needs} on this computer.`,
    install: 'Install it on this computer following the official instructions',
    installBody: (command: string) => `Once installed, ${command} should run in a terminal.`,
    docs: 'Open official instructions',
    launch: 'BaoCut starts it with this command',
    launchCopy: 'launch command',
    envNote: (keys: string[]) => `Adds the environment variables ${keys.join(', ')} at launch (values aren't shown here).`,
    login: 'If it needs signing in, sign in through it',
    loginBody: 'Follow its instructions in a terminal. Signing in happens in its own window; BaoCut never handles your account or password.',
    detectStep: 'Check',
    detectBody: 'BaoCut starts it once to confirm it connects, see whether it needs signing in, and get its model list.',
    launchRow: 'Launch command',
    launchRowHint: 'BaoCut starts it with this command via ACP (Agent Client Protocol).',
    versionPinned: (spec: string) => `The launch command pins ${spec}. To change versions, remove it and add it again with a custom command.`,
    versionOwn: 'To upgrade, follow its own instructions, then check again here.',
    account: (name: string, signedOut: boolean) =>
      `${signedOut ? 'Not signed in, or the sign-in has expired. ' : ''}Sign-in and billing both happen in ${name}; BaoCut never handles your account and doesn't charge extra.`,
    removeTitle: (name: string) => `Remove ${name}?`,
    removeBody: (name: string) =>
      `${name} will be removed from BaoCut's Agent list, along with its enabled state and default model. If new sessions use it by default, another available Agent takes over. Tasks using it will end. The program installed on this computer isn't affected, and you can add it again later.`,
    removed: (name: string) => `Removed ${name}`,
    removeFailed: (message: string) => `Couldn't remove: ${message}`,
  },

  /**
   * 「用 Codex 画图」那一行（settings-agent-provider.jsx:103-119）。设计稿说打开后「图片 Tab、工具页与 bcut image 里多一只
   * 「Codex 画图」」；现在出现它的地方是 `bcut image` 与会话里 Agent 的生图工具，菜单里的名字是 Provider 自己的「Codex」，照实写。
   */
  codexImage: {
    title: 'Draw with Codex',
    body: "No key needed; uses your Codex subscription. One image at a time, ignores size and quality, and 5–10× slower than the API. Once on, both bcut image and Agents in sessions can choose it (named “Codex”). It's never picked for you; to use it by default, set it as the default under Models › Image generation › Cloud models.",
    checking: 'Checking whether Codex on this computer can draw…',
    on: 'On',
    /** 补在 Provider 给的原因后面的句号（原因已经以句号结尾就不补）。 */
    period: '.',
    probeFailed: "Couldn't check whether Codex can draw · Click “Check again” to try again.",
    outdated: 'Codex is too old · Upgrade Codex CLI, then turn this on',
    signedOut: "Codex isn't signed in yet · Drawing uses your Codex account; sign in before turning this on.",
    notInstalled: "Codex wasn't found · Install Codex CLI and sign in before drawing.",
    unavailable: (detail: string | null) =>
      detail ? `Codex can't draw right now · ${detail}` : "Codex can't draw right now · Click “Check again” to try again.",
    turnedOn: 'Turned on Draw with Codex · Codex is now in the image generation model menu',
    turnedOff: 'Turned off Draw with Codex',
    toggleFailed: (enabled: boolean, message: string) =>
      enabled ? `Couldn't turn on Draw with Codex: ${message}` : `Couldn't turn off Draw with Codex: ${message}`,
  },

  /** 常见问题（page-settings-agent.jsx:142-157）。`link` 是答案下面那颗按钮。 */
  faq: [
    {
      key: 'cost',
      title: 'Do I need to pay or subscribe to BaoCut separately?',
      body: "No. Agents use the Claude or ChatGPT subscription you already have, and cost and quota are counted there. BaoCut ships no model of its own, collects no keys and relays nothing through the cloud. Without such a subscription you can skip Agents; the rest of BaoCut works as usual.",
    },
    {
      key: 'account',
      title: 'Can BaoCut see my account and password?',
      body: 'No. Signing in happens in the Agent’s own window. BaoCut only starts that program on your computer and hands it the video. It asks you before changing a video; the rules are in Settings › Privacy & permissions.',
    },
    {
      key: 'cloud',
      title: 'How is an Agent different from cloud models?',
      body: 'An Agent uses the coding assistant on your computer with its own subscription and can carry out multi-step tasks. Cloud models run single tools directly with an API key and are billed by usage. The two are set up separately.',
      link: 'models',
    },
    {
      key: 'terminal',
      title: 'Want to drive BaoCut with these Agents from a terminal?',
      body: 'Sessions in BaoCut need no extra setup. To use them in a terminal or other apps, install the BaoCut skill for them; see Settings › Skills.',
      link: 'skills',
    },
  ] as readonly { key: string; title: string; body: string; link?: 'models' | 'skills' }[],

  // ---- Agent 权限（设置 › 隐私与权限；page-settings-agent.jsx:166-185） ----
  permissionsHeading: 'You decide when it asks first',
  policyHeading: 'Fewer repeated prompts',
  policyHint: 'These rules allow the matching actions automatically; the access mode also affects whether it asks.',
  /**
   * 三条放行策略的文案。设计稿页面渲染的是 page-settings-agent.jsx:20-24 的 `policyCopy`（:158 取它），
   * data.js `agent.policy` 里的 label / desc 不上屏，只提供键与默认值。
   */
  policy: {
    read: { label: 'Read video content', desc: 'Lets the assistant view transcripts and video settings without asking each time.' },
    bcutro: { label: 'Query videos and progress', desc: "Lets it check information and progress. These commands don't change the video." },
    loop: { label: 'Respond to running AI tasks', desc: 'Lets it receive tasks and submit answers, with fewer interruptions in multi-step work.' },
  } as Record<keyof AgentPolicy, { label: string; desc: string }>,
  accessModes: 'Access modes',
  firstDefault: 'Default at first',
  alwaysAllowed: 'Always-allowed commands',
  saveFailed: (message: string) => `Couldn't save: ${message}`,
  ruleRemoved: (rule: string) => `Removed rule ${rule}`,
  ruleRemoveFailed: (message: string) => `Couldn't remove the rule: ${message}`,
  /** 访问模式那一行的说明：首次默认是哪一档、最近选的是哪一档。 */
  modeHint: (firstDefault: string, last: string | null) =>
    `Choose the access mode below the input box of each session. The first time it defaults to “${firstDefault}”; after that, new sessions keep your latest choice${last ? ` (currently “${last}”)` : ''}.`,

  // ---- 高级（page-settings-agent.jsx:167-183） ----
  advancedHeading: 'Advanced & troubleshooting',
  advancedHint: 'When the connection works, nothing here needs changing.',
  modelAutoUpdate: {
    label: 'Automatically update model lists',
    desc: "At launch and while running, regularly update each enabled Agent's own model list. When off, you can still refresh by hand in each Agent's details.",
  },
  executableHint:
    "BaoCut looks in PATH and common install locations (Homebrew, npm's global folder, ~/.local/bin). Ones installed with a version manager (nvm, asdf, mise) are sometimes elsewhere; enter the executable's full path here. Leave it empty to go back to automatic lookup.",
  techPanel: 'Technical info and locations',
  techTitle: 'Agent technical info',
  techSubtitle: 'Versions, paths and available models',
  techEmpty: 'No check results yet.',
  techNotInstalled: '· Not installed',
  techNoModels: 'No model list reported',
  /** 复制按钮与「已复制」提示里的那个名词。 */
  pathLabel: 'path',
  diagnosticsLabel: 'diagnostics',
  copyDiagnostics: 'Copy diagnostics',
  locateTitle: "Set an Agent's location by hand",
  locateSubtitle: "For when automatic detection can't find it",

  /** 命令块、应用内运行与手动指定位置（agent-command-block.tsx）。 */
  command: {
    copied: (label: string) => `Copied ${label}`,
    copyFailed: "Couldn't copy. Select the text and copy it yourself.",
    copy: (label: string) => `Copy ${label}`,
    stop: 'Stop',
    run: 'Run this command',
    output: 'Command output',
    running: 'Running',
    runningText: 'Running…',
    done: 'Done',
    stopped: "Stopped. What already ran isn't rolled back; you can run it again.",
    failed: (reason: string) => `Didn't succeed (${reason}). The output above says why; if it needs a password, run it in a terminal.`,
    runInTerminal: 'Run in terminal',
    exitCode: (code: number) => `exit code ${code}`,
    startFailed: (error: string) => `couldn't start: ${error}`,
    killed: 'the process was terminated',
    confirmInstall: (name: string) => `Run the install command for ${name}?`,
    confirmUpgrade: (name: string) => `Run the upgrade command for ${name}?`,
    confirmRun: 'Run',
    cancel: 'Cancel',
    confirmBefore: 'BaoCut will run the command below on this computer. Its output appears under the command, and you can stop it at any time.',
    confirmAfter: 'Commands that need a password fail here; run those in a terminal instead.',
    restored: (name: string) => `${name} is back to automatic lookup`,
    switched: (path: string) => `Now using ${path}`,
    notFoundAt: (path: string, command: string) => `No runnable ${command} found at ${path}`,
    saveFailed: (message: string) => `Couldn't save the location: ${message}`,
    locationLabel: (name: string) => `${name} location`,
    locationPlaceholder: (command: string) => `/full/path/${command}`,
    locationSaved: 'Set by hand. Clear it and save to go back to automatic lookup.',
    locationAuto: 'Empty = automatic lookup',
    save: 'Save',
    restoreAuto: 'Use automatic lookup',
  },

  // ---- Skills（产品设计 §6.9；原型 settings-agent-skills.jsx、settings-agent-skill-detail.jsx） ----
  skills: {
    lede: "A skill is a folder (a SKILL.md, plus optional reference files) that teaches the Agents in BaoCut to do things a certain way. With the switch on, an Agent uses it on its own when it seems relevant to the task; with it off, it's used only when you pick it from “+” in the input box. Turning skills on or off, adding or removing them takes effect from the next new Agent session.",
    search: 'Search skills',
    filter: 'Filter by source',
    tab: (label: string, count: number) => `${label} ${count}`,
    tabLabel: (label: string, count: number) => `${label}, ${count}`,
    add: 'Add skill',
    addFolder: 'Add from local folder',
    addGithub: 'Import from GitHub',
    loading: 'Loading skills…',
    loadFailed: (message: string) => `Couldn't load skills: ${message}`,
    retry: 'Try again',
    disconnected: 'Not connected to the BaoCut Runtime. Skills are listed once connected.',
    emptyTitle: 'No skills yet',
    emptyBody:
      'There are no skills available here yet. Add a skill folder you wrote, or import one someone shared on GitHub. Third-party skills are off after import; look through them before turning them on.',
    emptyWeb: 'There are no skills available here yet. In the browser you can only view and toggle them; add and import them in the BaoCut desktop app.',
    noMatch: (query: string) => `No skills found for “${query}”`,
    noMatchHint: 'Try another word, or switch to “All”.',
    noneInTab: (label: string) => `No ${label} skills yet`,
    webNote: 'In the browser you can view and toggle skills; add, import and remove them in the BaoCut desktop app.',
    view: (name: string) => `View ${name}`,
    enable: (name: string) => `Enable ${name}`,
    toggledOn: (name: string) => `Turned on “${name}”: from the next new session, the Agent uses it on its own when relevant`,
    toggledOff: (name: string) => `Turned off “${name}”: from now on it's used only when you pick it from “+” in the input box`,
    added: (name: string) => `Added “${name}”`,
    imported: (name: string) => `Imported “${name}”, off by default`,
    removed: (name: string) => `Removed “${name}”`,
    diagnosticsTitle: (count: number) => `${count} ${count === 1 ? 'folder' : 'folders'} couldn't be loaded`,
    diagnosticsHint: "These folders aren't usable skills and were skipped. Fix them and come back to this page to reload.",
    diagnosticCode: { invalid: 'Invalid format', 'duplicate-id': 'Duplicate name', 'builtin-conflict': 'Same name as a built-in skill' } as Record<string, string>,
    /** 没能加载的那一行：文件夹 · 原因：第一条问题。 */
    diagnosticLine: (dir: string, reason: string, issue: string) => `${dir} · ${reason}: ${issue}`,
    externalTitle: 'Use BaoCut from Agents in a terminal or other apps',
    externalBody:
      "The skills above are for the Agents inside BaoCut. To teach Claude Code or Codex in a terminal to transcribe, translate, edit and export with BaoCut, install the BaoCut skill for them. One-click install to these Agents' global locations, plus seeing where it's installed and whether it needs updating, is coming in a later version.",
  },

  skillDetail: {
    close: 'Close',
    stateOn: 'On: the Agent uses it on its own when relevant.',
    stateOff: "Off: used only when you pick it from “+” in the input box.",
    thirdPartyNote:
      "Third-party skills come from repositories other people share: look through one before turning it on. BaoCut never runs any file in a skill, and a skill can't widen an Agent's permissions.",
    source: 'Source',
    location: 'Location',
    version: 'Version',
    noVersion: 'Not specified',
    get reveal() {
      return revealLabel();
    },
    body: 'SKILL.md',
    emptyBody: 'Apart from the name and description at the top, SKILL.md has no other content.',
    files: (count: number) => `Files (${count})`,
    back: 'Back',
    notText: "Not a text file; not shown here",
    tooLarge: 'File too large; not shown here',
    loading: 'Loading…',
    loadFailed: (message: string) => `Couldn't load: ${message}`,
    remove: 'Remove',
    removeBuiltin: "Built-in skills can't be removed, but you can turn them off.",
    removeTitle: (name: string) => `Remove “${name}”?`,
    removeBody: (path: string) => `This deletes the folder ${path} and every file in it, and can't be undone. Sessions already running aren't affected.`,
    cancel: 'Cancel',
  },

  skillGithub: {
    title: 'Import from GitHub',
    label: 'Repository URL',
    placeholder: 'owner/repo',
    description: 'You can also paste a full URL, e.g. https://github.com/owner/repo/tree/main/skills/name',
    note: "Only downloads the files in the folder this URL points to, and never runs any of them. Imported skills count as “Third-party” and are off by default: they're used only when you pick them from “+” in the input box. Look through the content before deciding to turn one on.",
    submit: 'Import',
    pending: 'Downloading from GitHub…',
    cancel: 'Cancel',
  },
};

export type AgentMessages = typeof en;

/** 这一页的文案目录：在渲染或调用时读（`AGENT_COPY.lede`）。 */
export const AGENT_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
const M = AGENT_COPY;

export const AGENT_FACTS = live(() => M.facts);
export const providersMeta = (checked: string | null, builtin: number, added: number, found: number) => M.providersMeta(checked, builtin, added, found);
export const MORE_PROVIDERS = live(() => M.moreProviders);
export const UNTESTED = live(() => M.untested);
export const CATALOG_COPY = live(() => M.catalog);
export const CUSTOM_DIALOG_COPY = live(() => M.customDialog);
export const ADDED_COPY = live(() => M.added);
export const CODEX_IMAGE_COPY = live(() => M.codexImage);
export const AGENT_FAQ = live(() => M.faq);
export const POLICY_COPY = live(() => M.policy);
export const POLICY_KEYS: readonly (keyof AgentPolicy)[] = ['read', 'bcutro', 'loop'];
export const MODEL_AUTO_UPDATE = live(() => M.modelAutoUpdate);
export const SKILLS_COPY = live(() => M.skills);
export const SKILL_DETAIL_COPY = live(() => M.skillDetail);
export const SKILL_GITHUB_COPY = live(() => M.skillGithub);
