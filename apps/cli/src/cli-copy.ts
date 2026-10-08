import { defineMessages } from '@baocut/protocol';
import { zhHans } from './cli-copy.zh-Hans.ts';
import { zhHant } from './cli-copy.zh-Hant.ts';
import { ja } from './cli-copy.ja.ts';
import { ko } from './cli-copy.ko.ts';
import { es } from './cli-copy.es.ts';
import { fr } from './cli-copy.fr.ts';
import { de } from './cli-copy.de.ts';
import { nl } from './cli-copy.nl.ts';
import { ptBR } from './cli-copy.pt-BR.ts';
import { it } from './cli-copy.it.ts';
import { ru } from './cli-copy.ru.ts';
import { pl } from './cli-copy.pl.ts';
import { tr } from './cli-copy.tr.ts';
import { vi } from './cli-copy.vi.ts';

/**
 * CLI 自己的文字（派生命令、元命令与 Runtime 的归属；英文是键与类型的来源，译文在 `cli-copy.<语言>.ts`）。
 * 工具的标题与说明来自目录（给模型的原文），不在这里。
 */
const en = {
  // 一屏帮助（Agent 面设计 §5.7）
  helpTagline:
    'baocut — transcribe, translate, edit, dub and export videos with BaoCut. Run `baocut status` first to see what this machine can do.',
  helpFlows: 'Flows (return a job; wait until it finishes by default)',
  helpObjects: 'Objects',
  helpAdmin: 'Local admin (for people; agents ask the user first)',
  helpMore: 'More',
  helpMoreHelp: 'parameters, effect and examples',
  helpMoreSpec: 'machine-readable catalog (JSON)',
  helpMoreStatus: 'what this machine can do right now',
  helpGlobalFlags: '--json --project <dir> --yes --max-bytes <n> --result-file <file> --no-start',
  helpJobFlags: 'jobs: --no-wait --timeout <s> --progress jsonl',
  helpAdminVerbs: 'Local admin',
  helpGroupMore: (noun: string) => `baocut help ${noun} <command> for parameters and examples.`,
  helpFlagsPlaceholder: '[flags]',
  effectLabel: (effect: string) => `effect: ${effect}`,
  effectQuery: 'query (read-only)',
  effectMutation: 'mutation (changes state)',
  effectJob: 'job (returns a job; waits until it finishes by default)',
  effectDestructive: 'destructive (cannot be undone; needs --yes)',
  helpParameters: 'Parameters',
  helpNoParameters: '(none)',
  helpRequired: 'required',
  helpRepeatable: 'repeatable',
  helpPositionalNote: (positional: string, flag: string) =>
    `${positional} can be given as the positional argument or as ${flag}, not both.`,
  helpExamples: 'Examples',
  helpCommonFlags: 'Common flags',

  // 输出
  nextLabel: 'next',
  errorLabel: 'error',
  runtimeStartedNote: '(started a BaoCut Runtime in the background; it exits by itself when idle)',
  spilledNote: (maxBytes: number) =>
    `The result is larger than ${maxBytes} bytes: the complete result is in the file at path (JSON). coverage lists its top-level keys and array lengths, summary its short fields. Read the file, narrow the request with the flags in continueWith.paging, or rerun with --max-bytes continueWith.maxBytes.`,
  resultFileWritten:
    'The complete result is in the file at path (JSON) as --result-file asked. coverage lists its top-level keys and array lengths, summary its short fields.',

  // 参数
  unknownCommand: (command: string) => `Unknown command: ${command}. Run baocut --help to see the commands.`,
  unknownFlag: (flag: string, command: string) => `Unknown flag ${flag} for baocut ${command}. See baocut help ${command}.`,
  missingValue: (flag: string) => `${flag} needs a value.`,
  noValueExpected: (flag: string) => `${flag} is a switch and takes no value.`,
  duplicateFlag: (flag: string) => `${flag} was given more than once.`,
  badNumber: (flag: string, value: string) => `${flag} needs a number, got "${value}".`,
  badInteger: (flag: string, value: string) => `${flag} needs a whole number, got "${value}".`,
  badBoolean: (flag: string, value: string) => `${flag} needs true or false, got "${value}".`,
  badChoice: (flag: string, value: string, choices: readonly string[]) => `${flag} must be one of ${choices.join(', ')}; got "${value}".`,
  badValue: (flag: string, value: string) => `"${value}" is not a valid value for ${flag}.`,
  badJson: (flag: string, reason: string) => `${flag} needs JSON (a literal, @file or - for stdin): ${reason}`,
  expectedObject: (flag: string) => `${flag} needs a JSON object.`,
  readFileFailed: (flag: string, file: string, reason: string) => `Could not read ${file} for ${flag}: ${reason}`,
  stdinTwice: (flag: string) => `Standard input can only be read once (${flag} asked for it again).`,
  noPositional: (command: string, value: string) => `baocut ${command} takes no positional argument (got "${value}"); use flags.`,
  tooManyPositionals: (command: string, extra: string) => `baocut ${command} takes one positional argument; extra: ${extra}`,
  positionalAndFlag: (field: string, flag: string) => `${field} was given both as the positional argument and as ${flag}; give only one.`,
  missingRequired: (names: string, command: string) => `Missing ${names}. See baocut help ${command}.`,
  dryRunUnsupported: (command: string) => `baocut ${command} has no --dry-run.`,
  projectNotDirectory: (value: string) => `--project ${value} is not a directory.`,
  confirmationRequired: (command: string, summary: string) =>
    `baocut ${command} cannot be undone and was not run. It would do this: ${summary} Run it again with --yes once the user has agreed.`,
  confirmationNext: (command: string) => `baocut ${command} … --yes (after the user agrees)`,
  unknownSpec: (name: string) => `No tool named ${name}. baocut spec lists the whole catalog.`,
  unknownEditOp: (op: string) => `edits apply has no operation named ${op}. baocut edits ops lists them.`,
  catalogUnavailable: (command: string) =>
    `The offline catalog snapshot is missing and no Runtime is running. Generate it with \`${command}\` (in the repository), or start the Runtime with baocut runtime ensure.`,
  runtimeUsage: 'Usage: baocut runtime ensure | status | stop',
  installConfirmationRequired: (bundleId: string, size: string, source: string) =>
    `Installing the local model ${bundleId} downloads ${size} from ${source}; nothing was downloaded. Tell the user the size and run it again with --yes once they agree.`,
  sizeEstimated: ' (estimated)',

  // 元命令的帮助（§4.5）
  metaHelp: {
    help: "baocut help [<command>]\n\nWithout a command: the one-screen overview. With one (`help videos`, `help videos inspect`, `help runtime`): its parameters, effect and examples. Uses the running Runtime's catalog when there is one, the offline snapshot otherwise; never starts a Runtime.",
    spec: "baocut spec [<name>]\n\nThe machine-readable catalog as bare JSON (no envelope), with its interface version. <name> is a tool name (videos_inspect), a dotted name (videos.inspect), a command (videos inspect) or edits.<operation> for one operation of edits apply. Uses the running Runtime's catalog when there is one, the offline snapshot otherwise; never starts a Runtime.",
    version:
      'baocut version\n\nVersions of this CLI and, when one is running, of the Runtime, with both tool interface versions and whether they match. Bare JSON; never starts a Runtime.',
    status:
      'baocut status [--full] [--no-start]\n\nWhat this machine can do right now: the Runtime, each capability with its default and availability, local model bundles and external tools, with remedy commands for what is missing. Capabilities and model bundles are a summary; --full adds every provider with its models, parameters and limits, and the bundle details. Starts the Runtime when none is running; with --no-start it answers running: false instead.',
    runtime: [
      'baocut runtime ensure | status | stop',
      '',
      'The BaoCut Runtime this CLI talks to (one per BAOCUT_HOME).',
      '  ensure   find the running Runtime, or start one in the background; a Runtime the CLI started exits by itself',
      '           after runtime.idleExitMinutes idle (no connections, jobs or open services)',
      '  status   whether it runs, who started it, connections, active jobs, open services and idle exit; never starts one',
      '  stop     stop the Runtime the CLI started. RUNTIME_NOT_OWNED when the desktop app or someone else started it,',
      '           RUNTIME_IN_USE while the desktop app, another CLI or an unfinished job is using it (exit code 1)',
      '',
      'Flags: --json  --no-start (ensure: fail with exit code 3 instead of starting one)',
    ].join('\n'),
  } as Record<'help' | 'spec' | 'version' | 'status' | 'runtime', string>,

  // Runtime 的归属（§5.6）
  runtimeNotRunning: (home: string) => `No BaoCut Runtime is running for ${home}, and --no-start was given.`,
  runtimeNoEntry:
    'No BaoCut Runtime is running and none could be started: install the BaoCut app, run from the repository, or set BAOCUT_RUNTIME_ENTRY to the Runtime entry.',
  runtimeStartFailed: (reason: string, log: string) => `Could not start the BaoCut Runtime (${reason}). See ${log}.`,
  runtimeStartTimeout: (seconds: number, log: string) => `The BaoCut Runtime did not become ready within ${seconds} s. See ${log}.`,
  exitedWith: (code: number | null) => `it exited with code ${code ?? 'unknown'}`,
  runtimeConnectFailed: (reason: string) => `Could not connect to the BaoCut Runtime: ${reason}`,
  runtimeLost: (reason: string) => `Lost the connection to the BaoCut Runtime: ${reason}`,
  protocolMismatch: (reason: string) =>
    `This CLI and the BaoCut Runtime speak different protocol versions: ${reason}. Update the older one.`,
  interfaceMismatch: (cli: string, runtime: string, update: 'cli' | 'runtime') =>
    `This CLI uses tool interface version ${cli}, the Runtime uses ${runtime}. ${update === 'cli' ? 'Update the CLI.' : 'Update the BaoCut app (or restart the Runtime from the same checkout as the CLI).'}`,

  // 任务（§5.4）
  jobCancelling: (jobId: string) => `Cancelling ${jobId}… (press Ctrl-C again to stop waiting right away)`,
  jobCancelFailed: (reason: string) => `Could not cancel the job: ${reason}`,
  jobEnded: (state: string) => `The job ended: ${state}.`,
  statusFullNext:
    'baocut status --full lists every provider and model for each capability; for one capability run baocut models capabilities --capability <capability>, for bundle details baocut models list.',
  waitTimeout: (seconds: number, jobId: string) => `Stopped waiting after ${seconds} s; job ${jobId} keeps running.`,

  // 管理桶（admin/context.ts）
  noRuntimeClient: "This command doesn't connect to the Runtime",
};

export type CliMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
