/**
 * 设置 › Agent「添加更多 Agent」里可一键添加的 ACP 智能体目录（原型 designs/baocut/app/data.js 的 `ACP_CATALOG`，产品设计 §7.6）。
 * 不含 BaoCut 内置的九家。`command` 是 BaoCut 启动它用的命令数组（`npx -y 包@版本` 钉住版本）；`env` 是启动时附加的环境变量；
 * `version` 是目录记的版本（null = 由它自己的安装方式决定）；`docs` 是它的官方说明。介绍是 BaoCut 自己写的一句话。
 * 这些智能体 BaoCut 没有逐家验证过：能不能用以它自己的说明与探测结果为准。
 */
import { defineMessages } from '@baocut/protocol';
import { zhHans } from './acp-catalog.zh-Hans.ts';
import { zhHant } from './acp-catalog.zh-Hant.ts';
import { ja } from './acp-catalog.ja.ts';
import { ko } from './acp-catalog.ko.ts';
import { es } from './acp-catalog.es.ts';
import { fr } from './acp-catalog.fr.ts';
import { de } from './acp-catalog.de.ts';
import { nl } from './acp-catalog.nl.ts';
import { ptBR } from './acp-catalog.pt-BR.ts';
import { it } from './acp-catalog.it.ts';
import { ru } from './acp-catalog.ru.ts';
import { pl } from './acp-catalog.pl.ts';
import { tr } from './acp-catalog.tr.ts';
import { vi } from './acp-catalog.vi.ts';

/** 目录里各家的一句话介绍（英文是键与类型的来源，译文在 `acp-catalog.zh-Hans.ts`）。名字、命令、地址不翻。 */
const en = {
  descriptions: {
    'amp-acp': 'A community adapter that wraps the Amp coding agent in ACP.',
    'auggie': 'Augment Code’s command-line agent, good at retrieving context from large codebases.',
    'autohand': 'A coding agent from Autohand that uses its own model service.',
    'cline': 'An open-source autonomous coding agent that edits files and runs commands; bring your own model account.',
    'codebuddy-code': 'Tencent Cloud’s command-line coding assistant.',
    'codewhale': 'A terminal coding agent built for DeepSeek and open models.',
    'cortex-code': 'Snowflake’s Cortex coding agent, for teams already using Snowflake.',
    'corust-agent': 'A coding agent focused on Rust projects.',
    'crow-cli': 'A lightweight coding agent built for ACP from the start.',
    'deepagents': 'A general-purpose agent built on LangChain that can also write code.',
    'devin': 'Cognition’s Devin, in the terminal.',
    'dimcode': 'A coding agent that can switch between several major models.',
    'dirac': 'An open-source coding agent focused on fewer calls: parallel edits and syntax-tree editing.',
    'factory-droid': 'Factory’s Droid coding agent.',
    'fast-agent': 'An agent framework that connects to many model services, with built-in coding abilities. Requires uv.',
    'gjc': 'Uses your existing coding subscription, plans before acting, and asks before risky operations.',
    'glm-acp-agent': 'Uses models from the Zhipu GLM Coding Plan; you can switch models mid-session.',
    'goose': 'An open-source, extensible local agent that automates engineering chores end to end.',
    'hermes': 'Nous Research’s agent that improves itself from tasks it has done.',
    'junie': 'JetBrains’ coding agent.',
    'kilo': 'An open-source coding agent shared between the command line and the editor.',
    'kiro': 'Amazon’s coding agent, with native ACP support.',
    'minimax-code': 'MiniMax’s terminal coding agent.',
    'minion-code': 'A coding assistant built on the Minion framework with a set of developer tools. Requires uv.',
    'mistral-vibe': 'Mistral’s open-source coding assistant.',
    'nova': 'Compass AI’s software engineering agent.',
    'poolside': 'Poolside’s coding agent.',
    'qoder': 'Qoder’s command-line coding assistant that breaks down and carries out tasks on its own.',
    'qwen-code': 'Alibaba’s Qwen coding assistant.',
    'sigit': 'A coding agent that runs entirely on your computer and can use on-device local models.',
    'stakpak': 'An open-source, security-focused DevOps agent written in Rust.',
    'traecli': 'ByteDance TRAE’s command-line coding agent.',
    'vtcode': 'An open-source coding agent that understands code structure, runs commands with safety guardrails, and works with many models.',
  } as Record<string, string>,
};
export type AcpCatalogMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export interface AcpCatalogEntry {
  id: string;
  name: string;
  version: string | null;
  description: string;
  command: readonly string[];
  env?: Readonly<Record<string, string>>;
  docs: string;
}

export const ACP_CATALOG: readonly AcpCatalogEntry[] = [
  {
    id: 'amp-acp',
    name: 'Amp',
    version: '0.7.0',
    get description() {
      return M.descriptions['amp-acp']!;
    },
    command: ['amp-acp'],
    docs: 'https://github.com/tao12345666333/amp-acp',
  },
  {
    id: 'auggie',
    name: 'Auggie CLI',
    version: '0.33.0',
    get description() {
      return M.descriptions['auggie']!;
    },
    command: ['npx', '-y', '@augmentcode/auggie@0.33.0', '--acp'],
    env: { AUGMENT_DISABLE_AUTO_UPDATE: '1' },
    docs: 'https://www.augmentcode.com/',
  },
  {
    id: 'autohand',
    name: 'Autohand Code',
    version: '0.2.1',
    get description() {
      return M.descriptions['autohand']!;
    },
    command: ['npx', '-y', '@autohandai/autohand-acp@0.2.1'],
    docs: 'https://www.autohand.ai/cli/',
  },
  {
    id: 'cline',
    name: 'Cline',
    version: '3.0.46',
    get description() {
      return M.descriptions['cline']!;
    },
    command: ['npx', '-y', 'cline@3.0.46', '--acp'],
    docs: 'https://cline.bot/cli',
  },
  {
    id: 'codebuddy-code',
    name: 'Codebuddy Code',
    version: null,
    get description() {
      return M.descriptions['codebuddy-code']!;
    },
    command: ['codebuddy', '--acp'],
    docs: 'https://www.codebuddy.cn/cli/',
  },
  {
    id: 'codewhale',
    name: 'CodeWhale',
    version: '0.8.55',
    get description() {
      return M.descriptions['codewhale']!;
    },
    command: ['codewhale', 'serve', '--acp'],
    docs: 'https://codewhale.net/',
  },
  {
    id: 'cortex-code',
    name: 'Cortex Code',
    version: '1.0.73',
    get description() {
      return M.descriptions['cortex-code']!;
    },
    command: ['cortex', 'acp', 'serve'],
    docs: 'https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli',
  },
  {
    id: 'corust-agent',
    name: 'Corust Agent',
    version: '0.5.1',
    get description() {
      return M.descriptions['corust-agent']!;
    },
    command: ['corust-agent-acp'],
    docs: 'https://github.com/Corust-ai/corust-agent-release/releases',
  },
  {
    id: 'crow-cli',
    name: 'crow-cli',
    version: '0.1.23',
    get description() {
      return M.descriptions['crow-cli']!;
    },
    command: ['crow-cli', 'acp'],
    docs: 'https://crow-ai.dev/',
  },
  {
    id: 'deepagents',
    name: 'DeepAgents',
    version: '0.1.20',
    get description() {
      return M.descriptions['deepagents']!;
    },
    command: ['npx', '-y', 'deepagents-acp@0.1.20'],
    docs: 'https://docs.langchain.com/oss/javascript/deepagents/overview',
  },
  {
    id: 'devin',
    name: 'Devin CLI',
    version: null,
    get description() {
      return M.descriptions['devin']!;
    },
    command: ['devin', 'acp'],
    docs: 'https://cli.devin.ai/docs',
  },
  {
    id: 'dimcode',
    name: 'DimCode',
    version: '0.2.36',
    get description() {
      return M.descriptions['dimcode']!;
    },
    command: ['npx', '-y', 'dimcode@0.2.36', 'acp'],
    docs: 'https://dimcode.dev/docs/acp.html',
  },
  {
    id: 'dirac',
    name: 'Dirac',
    version: '0.4.22',
    get description() {
      return M.descriptions['dirac']!;
    },
    command: ['npx', '-y', 'dirac-cli@0.4.22', '--acp'],
    docs: 'https://dirac.run',
  },
  {
    id: 'factory-droid',
    name: 'Factory Droid',
    version: '0.179.0',
    get description() {
      return M.descriptions['factory-droid']!;
    },
    command: ['npx', '-y', 'droid@0.179.0', 'exec', '--output-format', 'acp-daemon'],
    env: { DROID_DISABLE_AUTO_UPDATE: 'true', FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false' },
    docs: 'https://factory.ai/product/cli',
  },
  {
    id: 'fast-agent',
    name: 'fast-agent',
    version: '0.9.22',
    get description() {
      return M.descriptions['fast-agent']!;
    },
    command: ['uvx', '--from', 'fast-agent-acp==0.9.22', 'fast-agent-acp', '-x'],
    docs: 'https://fast-agent.ai/acp/',
  },
  {
    id: 'gjc',
    name: 'Gajae Code',
    version: null,
    get description() {
      return M.descriptions['gjc']!;
    },
    command: ['gjc', 'acp'],
    env: { GJC_ACP_PERMISSION_MODE: 'prompt' },
    docs: 'https://gajae-code.com',
  },
  {
    id: 'glm-acp-agent',
    name: 'GLM Agent',
    version: '1.3.0',
    get description() {
      return M.descriptions['glm-acp-agent']!;
    },
    command: ['npx', '-y', 'glm-acp-agent@1.3.0'],
    docs: 'https://github.com/stefandevo/glm-acp-agent',
  },
  {
    id: 'goose',
    name: 'goose',
    version: '1.33.1',
    get description() {
      return M.descriptions['goose']!;
    },
    command: ['goose', 'acp'],
    docs: 'https://block.github.io/goose/',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    version: null,
    get description() {
      return M.descriptions['hermes']!;
    },
    command: ['hermes', 'acp'],
    docs: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp',
  },
  {
    id: 'junie',
    name: 'Junie',
    version: '1468.30.0',
    get description() {
      return M.descriptions['junie']!;
    },
    command: ['junie', '--acp', 'true'],
    docs: 'https://junie.jetbrains.com/docs/junie-cli-acp.html',
  },
  {
    id: 'kilo',
    name: 'Kilo',
    version: '7.2.40',
    get description() {
      return M.descriptions['kilo']!;
    },
    command: ['kilo', 'acp'],
    docs: 'https://kilo.ai/docs/code-with-ai/platforms/cli',
  },
  {
    id: 'kiro',
    name: 'Kiro CLI',
    version: null,
    get description() {
      return M.descriptions['kiro']!;
    },
    command: ['kiro-cli', 'acp'],
    docs: 'https://kiro.dev/docs/cli/acp/',
  },
  {
    id: 'minimax-code',
    name: 'MiniMax Code',
    version: '0.1.2',
    get description() {
      return M.descriptions['minimax-code']!;
    },
    command: ['npx', '-y', '@minimax-ai/code@0.1.2', 'acp'],
    docs: 'https://agent.minimax.io',
  },
  {
    id: 'minion-code',
    name: 'Minion Code',
    version: '0.1.44',
    get description() {
      return M.descriptions['minion-code']!;
    },
    command: ['uvx', '--from', 'minion-code==0.1.44', 'minion-code', 'acp'],
    docs: 'https://github.com/femto/minion-code',
  },
  {
    id: 'mistral-vibe',
    name: 'Mistral Vibe',
    version: '2.9.3',
    get description() {
      return M.descriptions['mistral-vibe']!;
    },
    command: ['vibe-acp'],
    docs: 'https://github.com/mistralai/mistral-vibe',
  },
  {
    id: 'nova',
    name: 'Nova',
    version: '1.1.29',
    get description() {
      return M.descriptions['nova']!;
    },
    command: ['npx', '-y', '@compass-ai/nova@1.1.29', 'acp'],
    docs: 'https://www.compassap.ai/portfolio/nova.html',
  },
  {
    id: 'poolside',
    name: 'Poolside',
    version: '1.0.0',
    get description() {
      return M.descriptions['poolside']!;
    },
    command: ['pool', 'acp'],
    docs: 'https://docs.poolside.ai/cli/pool',
  },
  {
    id: 'qoder',
    name: 'Qoder CLI',
    version: '1.1.4',
    get description() {
      return M.descriptions['qoder']!;
    },
    command: ['npx', '-y', '@qoder-ai/qodercli@1.1.4', '--acp'],
    docs: 'https://qoder.com',
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    version: '0.20.1',
    get description() {
      return M.descriptions['qwen-code']!;
    },
    command: ['npx', '-y', '@qwen-code/qwen-code@0.20.1', '--acp', '--experimental-skills'],
    docs: 'https://qwenlm.github.io/qwen-code-docs/en/users/overview',
  },
  {
    id: 'sigit',
    name: 'siGit Code',
    version: '1.0.3',
    get description() {
      return M.descriptions['sigit']!;
    },
    command: ['sigit'],
    docs: 'https://github.com/getsigit/sigit',
  },
  {
    id: 'stakpak',
    name: 'Stakpak',
    version: '0.3.80',
    get description() {
      return M.descriptions['stakpak']!;
    },
    command: ['stakpak', 'acp'],
    docs: 'https://stakpak.dev/',
  },
  {
    id: 'traecli',
    name: 'TRAE CLI',
    version: null,
    get description() {
      return M.descriptions['traecli']!;
    },
    command: ['traecli', 'acp', 'serve'],
    docs: 'https://docs.trae.cn/cli_get-started-with-trae-cli',
  },
  {
    id: 'vtcode',
    name: 'VT Code',
    version: '0.96.14',
    get description() {
      return M.descriptions['vtcode']!;
    },
    command: ['vtcode', 'acp'],
    env: { VT_ACP_ENABLED: '1', VT_ACP_ZED_ENABLED: '1' },
    docs: 'https://github.com/vinhnx/VTCode/blob/main/docs/guides/zed-acp.md',
  },
];
