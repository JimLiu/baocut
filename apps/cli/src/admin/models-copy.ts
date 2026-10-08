import {
  MODEL_SERVICE_CAPABILITIES,
  USAGE_PERIODS,
  defineMessages,
  type ModelBundleStatus,
  type ModelServiceCapability,
  type ProviderUnavailableReason,
  type ModelsDirInfo,
  type ProviderAccountStatus,
  type UsagePeriod,
  type UsageRow,
} from '@baocut/protocol';
import { zhHans } from './models-copy.zh-Hans.ts';
import { zhHant } from './models-copy.zh-Hant.ts';
import { ja } from './models-copy.ja.ts';
import { ko } from './models-copy.ko.ts';
import { es } from './models-copy.es.ts';
import { fr } from './models-copy.fr.ts';
import { de } from './models-copy.de.ts';
import { nl } from './models-copy.nl.ts';
import { ptBR } from './models-copy.pt-BR.ts';
import { it } from './models-copy.it.ts';
import { ru } from './models-copy.ru.ts';
import { pl } from './models-copy.pl.ts';
import { tr } from './models-copy.tr.ts';
import { vi } from './models-copy.vi.ts';

const s = (n: number) => (n === 1 ? '' : 's');

/** `baocut models …` 的文案（英文是键与类型的来源，译文在 `models-copy.<语言>.ts`）。 */
const en = {
  /** `baocut models --help` 与 `baocut help models` 的正文（管理桶的子命令）。 */
  help: `Usage:
  baocut models cancel <bundleId> [--discard]
                                   Stop installing (what's already downloaded is kept; install again to resume);
                                   --discard deletes it as well
  baocut models repair <bundleId> [--yes]
                                   Verify each file's sha256 and download only missing or damaged files again
                                   (confirmation works as for install)
  baocut models dir                Show the local models folder: location, source, used and free space, number of recognized models
  baocut models dir --set <path> [--move|--switch]
                                   Change the models folder: --move moves existing models there (a background task, rolled back
                                   on failure); --switch only changes the location (the old files stay; only models already in the
                                   new location are usable); one of the two is required when the current folder has models.
                                   Refused while a task is using a local model; read-only when the BAOCUT_MODELS_DIR environment
                                   variable sets it
  baocut models dir --reset [--move|--switch]
                                   Restore the default location (<BAOCUT_HOME>/models), same rules as --set
  baocut models configure <providerId> [options]
                                   Configure an online provider: a catalog provider (openai, google, elevenlabs, anthropic, deepseek,
                                   qwen, and others; see baocut models capabilities), or a custom OpenAI-compatible endpoint custom:<name>.
                                   The agent provider agent:codex only has an on/off switch (it uses this computer's Codex sign-in, no key)
    --enable | --disable           Enable (standing grants send asset audio, text, or prompts to it when needed) or disable
    --key-stdin                    Read the API key from stdin (keys in command-line arguments aren't accepted): replaces the
                                   first account's key, or creates an account if there is none (for multiple accounts, use
                                   baocut models accounts)
    --endpoint <url>               Base URL of a custom endpoint (required the first time); catalog providers can point it at a
                                   proxy or gateway
    --model <id> ...               Transcription models the custom endpoint provides (repeatable; the first is the default)
    --speech-model <id> ...        Speech synthesis models the custom endpoint provides (/audio/speech; repeatable)
    --image-model <id> ...         Image generation models the custom endpoint provides (/images/generations; repeatable)
    --text-model <id> ...          Text models the custom endpoint provides (/chat/completions; repeatable)
                                   Giving models of any kind replaces all declared models
    --verify                       Verify the new key and endpoint with the provider once before saving
  baocut models accounts <providerId>
                                   List a provider's accounts: order, name, masked key, on/off, and status (calls use the
                                   first enabled account that has a key, and don't move on to the next one on errors)
  baocut models accounts add <providerId> [--label <name>] [--region <region>] [--endpoint <url>] [--verify]
                                   Add an account; the key is read from stdin; --region takes a region from the catalog (such as
                                   global or cn); --verify checks with the provider first and doesn't save if that fails.
                                   Adding an account doesn't enable the provider
  baocut models accounts remove <providerId> <accountId|name>
                                   Remove an account and its key (after removing the last account the provider stays,
                                   just without a usable key)
  baocut models accounts use <providerId> <accountId|name>
                                   Make it preferred: move this account to the top
  baocut models usage [--period <${USAGE_PERIODS.join('|')}>] [--provider <id>]
                                   Calls, usage, and spending for online providers and agents (last 30 days by default):
                                   amounts estimated from list prices, amounts reported by the provider, and unknown costs are
                                   listed separately, with no currency conversion; broken down by provider, capability, model,
                                   and account
  baocut models default <capability> <providerId|none> [modelId]
                                   Set or clear the default provider and model for a capability (${MODEL_SERVICE_CAPABILITIES.join(', ')})
  baocut models remove <bundleId|providerId>
                                   Delete a local model bundle (shared components other bundles use are kept; refused while a
                                   task is using it); or remove an online provider: a custom endpoint (custom:<name>) is deleted
                                   entirely; a catalog provider is disabled and all its accounts and keys are deleted
  baocut models refresh <providerId>
                                   Fetch and cache the model (and voice) list from an online provider: built-in models missing
                                   from the list are marked unavailable; if the list can't be fetched, the built-in list is used
                                   as before
  baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]
                                   Show or set the default reasoning effort for text generation and each provider's concurrency
                                   limit (default 4); default restores the factory value`,
  byteProgressUnknown: (done: string) => `${done} received (total size unknown)`,
  byteProgress: (done: string, total: string, percent: number) => `${done} / ${total} (${percent}%)`,
  bundleStates: {
    'not-installed': 'Not installed',
    downloading: 'Downloading',
    installed: 'Installed',
    loading: 'Loading',
    ready: 'Ready',
    busy: 'Busy',
    unloading: 'Unloading',
    error: 'Unavailable',
  } satisfies Record<ModelBundleStatus['state'], string>,
  installStates: {
    queued: 'Queued',
    downloading: 'Downloading',
    verifying: 'Verifying and publishing',
    paused: 'Paused',
  } satisfies Record<NonNullable<ModelBundleStatus['install']>['state'], string>,
  bundleState: (label: string, state: string, reason: string | null | undefined) => `${label} (${state}${reason ? ` / ${reason}` : ''})`,
  componentInstalled: 'installed',
  componentMissing: 'missing',
  sharedWith: (bundles: readonly string[]) => `  shared with ${bundles.join(', ')}`,
  installTask: (jobId: string) => `  task ${jobId}`,
  resumeHint: (bundleId: string) => `; resume with baocut models install ${bundleId}`,
  installLine: (state: string, progress: string, task: string, hint: string) => `  Install: ${state}  ${progress}${task}${hint}`,
  checkPassed: 'passed',
  checkFailed: (code: string | null | undefined) => `failed${code ? ` (${code})` : ''}`,
  checkLine: (result: string, at: string, detail: string | null | undefined) => `  Check: ${result}  ${at}${detail ? `  ${detail}` : ''}`,
  remedyAppFileMissing: "To fix: reinstall BaoCut; repairing the model won't help",
  remedyRepair: (bundleId: string) => `To fix: baocut models repair ${bundleId} re-downloads only the broken files; check again afterwards`,
  remedyMaybeRepair: (bundleId: string) =>
    `To fix: try baocut models repair ${bundleId} first (it re-downloads only the broken files), then check again`,
  remedyOutOfMemory: 'To fix: quit other apps that use a lot of memory, or pick a smaller model, then check again',
  remedy: (text: string) => `To fix: ${text}`,
  upToDate: (repair: boolean, bundleId: string) =>
    repair ? `${bundleId} files are all intact; nothing to repair` : `${bundleId} is already installed; nothing to download`,
  planHeader: (repair: boolean, bundleId: string, source: string) => `${repair ? 'Repair' : 'Install'} ${bundleId} from ${source}`,
  planKeep: (component: string, repo: string) => `  ${component}  ${repo}  installed, kept`,
  planDownload: (component: string, repo: string, files: number, size: string) =>
    `  ${component}  ${repo}  download ${files} file${s(files)}, ${size}`,
  sizeUnknown: 'size unknown',
  toDownloadEstimate: (estimate: string) => `To download: size unknown, about ${estimate}`,
  toDownload: (size: string) => `To download: ${size}`,
  resumed: (size: string) => `Resume: ${size} is already in the staging area and won't be downloaded again`,
  freeSpace: (size: string, short: boolean) => `Free space: ${size}${short ? ' (not enough)' : ''}`,
  sizeAbout: (size: string) => `about ${size}`,
  installPrompt: (repair: boolean, size: string) => `${repair ? 'Repair' : 'Install'} and download ${size}? [y/N] `,
  noSpace: (need: string, have: string) => `Disk space: this needs ${need}, only ${have} left`,
  removed: (files: readonly string[]) => `Deleted: ${files.join(', ')}`,
  nothingRemoved: 'No files deleted',
  keptInUse: (repo: string, users: readonly string[]) => `Kept ${repo}: still used by ${users.join(', ')}`,
  keptOtherVersion: (repo: string) => `Kept ${repo}: the folder holds a different version that isn't part of this model bundle`,
  dirSources: {
    default: 'default location',
    setting: 'folder chosen in Settings',
    env: 'BAOCUT_MODELS_DIR environment variable (read-only: to change it, change the variable and restart BaoCut)',
  } satisfies Record<ModelsDirInfo['source'], string>,
  dirSource: (label: string) => `  Source: ${label}`,
  dirMissing: "  This folder doesn't exist (this also happens when an external drive isn't connected)",
  dirNotWritable: "  BaoCut can't write to this folder",
  dirUsage: (used: string, free: string | null, models: number) =>
    `  ${used} used${free ? ` · ${free} free on this disk` : ''} · ${models} model${s(models)} found`,
  dirDefault: (path: string) => `  Default location: ${path}`,
  dirMoving: (to: string | null | undefined, jobId: string) => `  Moving${to ? ` to ${to}` : ''} (task ${jobId})`,
  dirEnvLocked: 'The models folder is set by the BAOCUT_MODELS_DIR environment variable: to change it, change the variable and restart BaoCut',
  dirProblemMissing: "This folder doesn't exist: this also happens when an external drive isn't connected; connect it and try again",
  dirProblemNotWritable: "BaoCut can't write to this folder: pick a writable location, or change its permissions first",
  dirProblemNested: 'The new location and the current models folder contain each other: pick a folder that is neither inside it nor contains it',
  dirProblemSame: "That's already the current models folder",
  dirFound: (count: number, size: string) => `Found ${count} downloaded model${s(count)} (${size}), ready to use`,
  dirEmpty: 'No models in this folder yet; models you download from now on go here',
  dirFree: (size: string) => `${size} free on this disk`,
  moveSameVolume: 'Same disk: moving only renames, so it takes no extra space',
  moveSize: (size: string, fits: boolean) => `moving ${size}${fits ? '' : ", which won't fit"}`,
  dirCurrentHas: (size: string, move: string) => `The current folder has ${size} of models: ${move}`,
  moveOrSwitch: 'Use only one of --move and --switch',
  accountStates: {
    unknown: 'Not verified',
    ok: 'OK',
    'invalid-key': 'Invalid key',
    'rate-limited': 'Rate limited',
    'quota-exhausted': 'Quota used up',
  } satisfies Record<ProviderAccountStatus['state'], string>,
  rateLimitedUntil: (label: string, until: string) => `${label} (until ${until})`,
  noAccounts: 'No accounts yet: baocut models accounts add <providerId> reads the key from standard input',
  accountEnabled: 'enabled',
  accountDisabled: 'disabled',
  accountKeyUnreadable: "can't read key",
  accountRegion: (region: string) => `region ${region}`,
  accountEndpoint: (endpoint: string) => `endpoint ${endpoint}`,
  accountLastUsed: (at: string) => `last used ${at}`,
  accountCurrent: 'in use',
  accountChoice: (accountId: string, label: string) => `${accountId} (${label})`,
  noAccountChoices: 'no accounts',
  listSep: ', ',
  accountAmbiguous: (count: number, ref: string, choices: string) => `${count} accounts are named "${ref}"; use an accountId: ${choices}`,
  accountNotFound: (ref: string, choices: string) => `No such account: ${ref} (choices: ${choices})`,
  usagePeriods: { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' } satisfies Record<UsagePeriod, string>,
  unitTokens: (input: string, output: string) => `input ${input} / output ${output} tokens`,
  unitCached: (cached: string) => `${cached} cached`,
  unitAudio: (minutes: string) => `${minutes} min of audio`,
  unitChars: (chars: string) => `${chars} characters`,
  unitImages: (images: number) => `${images} image${s(images)}`,
  clauseSep: ', ',
  costKinds: {
    reported: 'reported by provider',
    estimated: 'estimated from list prices',
    mixed: 'reported and estimated',
    unknown: 'cost unknown',
  } satisfies Record<UsageRow['costKind'], string>,
  rowCalls: (calls: number, failed: number) => `${calls} call${s(calls)}${failed > 0 ? ` (${failed} failed)` : ''}`,
  costApprox: (money: string, kind: string) => `≈ ${money} (${kind})`,
  usageHeader: (scope: string | undefined, period: string, from: string, to: string) =>
    `Usage (${scope ? `${scope}, ` : ''}${period}: ${from} to ${to})`,
  noCalls: '  No calls yet',
  totalCalls: (calls: number, failed: number) => `  ${calls} call${s(calls)}${failed > 0 ? ` (${failed} failed)` : ''}`,
  usageUnits: (units: string) => `  Usage: ${units}`,
  spentEstimated: (money: string) => `  Spent ≈ ${money} (estimated from list prices)`,
  spentReported: (money: string) => `  Spent ${money} (reported by provider)`,
  unknownCostCalls: (calls: number) => `  Cost unknown for ${calls} more call${s(calls)}`,
  noBilledCalls: '  No billed calls',
  byProvider: 'By provider',
  byCapability: 'By capability',
  byModel: 'By model',
  byAccount: 'By account',
  // ---- 管理桶 `baocut models …`（admin/models.ts） ----
  usageRepair: 'Usage: baocut models repair <bundleId> [--yes]',
  usageCancel: 'Usage: baocut models cancel <bundleId> [--discard]',
  usageConfigure: 'Usage: baocut models configure <providerId> [--enable|--disable] [--key-stdin] [--endpoint <url>] …',
  usageDefault: 'Usage: baocut models default <capability> <providerId|none> [modelId]',
  usageRemove: 'Usage: baocut models remove <bundleId|providerId>',
  usageRefresh: 'Usage: baocut models refresh <providerId>',
  usageParameters: 'Usage: baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]',
  usageAccounts:
    'Usage: baocut models accounts <providerId> | add <providerId> [--label <name>] [--region <region>] [--verify] | remove <providerId> <account> | use <providerId> <account>',
  usageDir: 'Usage: baocut models dir [--set <path> [--move|--switch] | --reset [--move|--switch]]',
  cancelledDiscarded: 'Stopped and deleted the downloaded part',
  cancelledKept: 'Stopped (the downloaded part is kept; run install again to resume)',
  unknownCapability: (capability: string, choices: readonly string[]) => `Unknown capability: ${capability} (one of ${choices.join(', ')})`,
  clearDefaultNoModel: "Don't give a model when clearing the default",
  defaultSet: (label: string, provider: string, model: string) => `${label} default: ${provider} / ${model}`,
  defaultCleared: (label: string) => `${label} default cleared`,
  customProviderDeleted: (id: string) => `Deleted ${id} (defaults that point to it are kept and shown as unavailable)`,
  providerRemoved: (id: string) =>
    `Removed ${id}: disabled, and all its accounts and keys deleted (defaults that point to it are kept and shown as unavailable)`,
  providerRefreshFailed: (id: string, error: string | undefined) =>
    `Couldn't refresh ${id}: ${error ?? 'unknown reason'}; still using the built-in model list`,
  providerRefreshed: (id: string, models: number, voices: number | undefined, at: string) =>
    `Refreshed ${id}: ${models} model${s(models)}${voices !== undefined ? `, ${voices} voice${s(voices)}` : ''} (${at})`,
  periodChoices: (periods: readonly string[]) => `--period must be one of ${periods.join(', ')}`,
  enableDisableConflict: 'Use only one of --enable and --disable',
  saved: (description: string) => `Saved: ${description}`,
  verifiedAndSaved: 'Verified and saved',
  savedPlain: 'Saved',
  providerNotEnabled: (id: string) => `${id} isn't enabled yet: baocut models configure ${id} --enable`,
  accountRemoved: (name: string) => `Removed account ${name}`,
  accountPreferred: (name: string) => `Set as preferred: ${name}`,
  providerHasNoAccounts: (id: string) => `${id} has no accounts`,
  noSuchProvider: (id: string) => `No such provider: ${id}`,
  alreadyRepairing: (jobId: string) => `Already repairing (task ${jobId}); showing progress`,
  nothingToRepair: 'No files to repair',
  notTtyConfirmDownload: 'Not running in a terminal: add --yes once the user confirms the download',
  notDownloaded: 'Not downloaded',
  nothingToDownload: 'Nothing to download',
  repairDone: 'Repair complete',
  repairPartialKept: (bundleId: string) => `The downloaded part is kept: run baocut models repair ${bundleId} to resume`,
  setResetConflict: (usage: string) => `Use only one of --set and --reset. ${usage}`,
  dirHasModels: 'The current folder has models: add --move to move them, or --switch to change only the location (the old files are kept)',
  dirChanged: (dir: string, oldFilesKept: boolean) => `Models folder changed to ${dir}${oldFilesKept ? ' (files in the old location are kept)' : ''}`,
  modelsMoved: (dir: string) => `Moved the models to ${dir}`,
  dirRolledBack: 'Rolled back: the original models folder is unchanged',
  pasteKeyHint: 'Paste the API key, press Return, then press Ctrl-D to finish:',
  noKeyOnStdin: 'No API key on standard input',
  keyHasWhitespace: "The API key shouldn't contain spaces or line breaks: put only the key itself on standard input",
  positiveInteger: (option: string) => `${option} must be a positive integer`,
  effortChoices: (efforts: readonly string[]) => `--effort must be one of ${efforts.join(', ')}`,
  capabilityLabels: {
    transcribe: 'Transcription',
    synthesizeSpeech: 'Speech synthesis',
    generateImage: 'Image generation',
    generateText: 'Text generation',
    separateAudio: 'Voice separation',
  } satisfies Record<ModelServiceCapability, string>,
  unavailableLabels: {
    'not-configured': 'not enabled',
    'missing-credential': 'API key missing',
    'not-installed': 'not installed',
    'signed-out': 'signed out',
    outdated: 'version too old',
    'not-paired': 'not paired',
    'not-connected': "can't connect",
    unsupported: 'unsupported',
    resource: 'disabled after repeated errors',
  } satisfies Record<ProviderUnavailableReason, string>,
  unavailable: 'unavailable',
  capabilityState: (label: string, available: boolean, reason: string) => `${label} ${available ? 'available' : `unavailable (${reason})`}`,
  capabilitySep: ', ',
  configEnabled: 'enabled',
  configDisabled: 'disabled',
  keyState: (set: boolean) => `key ${set ? 'set' : 'not set'}`,
  configEndpoint: (url: string) => `endpoint ${url}`,
  modelListRefreshed: (at: string) => `model list refreshed ${at}`,
  lastRefreshFailed: (at: string) => `last refresh failed (${at}); using the built-in list`,
  textParameters: (effort: string | null | undefined, concurrency: number) =>
    `Default reasoning effort: ${effort ?? "the model's own"} · concurrency per provider ${concurrency}`,
  markDefault: 'default',
  markDeclared: 'user-declared',
  wordTimestampsNative: 'word timestamps',
  wordTimestampsEstimated: 'word times estimated from length',
  maxInputMegabytes: (mb: string) => `≤ ${mb} MB per call`,
  maxDurationMinutes: (minutes: number) => `≤ ${minutes} min per call`,
  voiceCount: (count: number, defaultVoice: string | null | undefined) =>
    `${count} voice${s(count)} (default ${defaultVoice ?? 'none'})`,
  noPresetVoices: 'no preset voices; a voice must be given',
  acceptsCustomVoices: 'accepts custom voices',
  maxInputChars: (count: number) => `≤ ${count} characters per call`,
  acceptsInstructions: 'accepts style instructions',
  sizeCount: (count: number, defaultSize: string | null | undefined) =>
    `${count} size${s(count)}${defaultSize ? ` (default ${defaultSize})` : ''}`,
  aspectRatios: (ratios: string) => `aspect ratios ${ratios}`,
  maxImageCount: (count: number) => `≤ ${count} images per call`,
  sizeAndSeedFixed: "size and seed can't be set",
  contextTokens: (count: number) => `context ${count} tokens`,
  maxOutputTokens: (count: number | undefined) => `output ≤ ${count} tokens`,
  efforts: (efforts: string, defaultEffort: string | null | undefined) =>
    `reasoning effort ${efforts}${defaultEffort ? ` (default ${defaultEffort})` : ''}`,
  structuredOutput: 'structured output',
  subscription: 'included in a subscription, quota unknown',
  modelName: (id: string, label: string) => `${id} (${label})`,
};

export type ModelsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
