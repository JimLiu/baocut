import { defineMessages } from '@baocut/protocol';
import { zhHans } from './models-added-copy.zh-Hans.ts';
import { zhHant } from './models-added-copy.zh-Hant.ts';
import { ja } from './models-added-copy.ja.ts';
import { ko } from './models-added-copy.ko.ts';
import { es } from './models-added-copy.es.ts';
import { fr } from './models-added-copy.fr.ts';
import { de } from './models-added-copy.de.ts';
import { nl } from './models-added-copy.nl.ts';
import { ptBR } from './models-added-copy.pt-BR.ts';
import { it } from './models-added-copy.it.ts';
import { ru } from './models-added-copy.ru.ts';
import { pl } from './models-added-copy.pl.ts';
import { tr } from './models-added-copy.tr.ts';
import { vi } from './models-added-copy.vi.ts';

/**
 * 设置 › 模型 › 本地模型的「添加模型」（设计稿 settings-add-model.jsx、model-audiocpp.js）：能力页上的入口、添加对话框，
 * 以及添加进来的模型在行上的标签、来源与移出列表。英文是键与类型的来源，译文在 `models-added-copy.<语言>.ts`。
 */
const en = {
  /** 能力页（语音合成、音乐生成、人声分离）上的入口一行。`n`：内置之外还能加的模型族数。 */
  entryLabel: 'Add more models',
  entryDesc: (n: number, group: 'tts' | 'music' | 'sep') =>
    group === 'sep'
      ? `Besides the built-in one, audio.cpp has ${n} more vocal and background separation ${n === 1 ? 'model' : 'models'} you can use. You can also add a GGUF file of your own.`
      : `Besides the built-in ones, audio.cpp supports ${n} more ${group === 'music' ? (n === 1 ? 'music model' : 'music models') : n === 1 ? 'speech model' : 'speech models'}, and other precisions of the built-in ones. You can also add a GGUF file of your own.`,
  entryButton: 'Add model…',

  title: 'Add audio.cpp models',
  /** `engine`：内置 audio.cpp 引擎的版本。 */
  lede: (engine: string) =>
    `Any model supported by BaoCut’s built-in audio.cpp engine (${engine}) can be added. Added models download, play and delete like the built-in ones. BaoCut hasn’t tested each of them, so try a model and check it to see how well it works.`,
  loading: 'Loading the audio.cpp model list…',
  loadFailed: (text: string) => `Couldn’t load the model list: ${text}`,
  groupsLabel: 'Model groups',
  groups: { tts: 'Speech', music: 'Music', sep: 'Separation', idle: 'Not usable yet', custom: 'Your own file' },
  searchLabel: 'Search audio.cpp models',
  searchPlaceholder: 'Search by name, language or feature',
  countFound: (n: number) => (n === 1 ? '1 found' : `${n} found`),
  countIdle: (n: number) => `${n} · can’t be added yet`,
  countFamilies: (n: number) => (n === 1 ? '1 model family' : `${n} model families`),
  listLabel: 'audio.cpp models',
  empty: (q: string) => `Nothing matches “${q}” in this group. If the file you want isn’t listed, you can add it yourself.`,
  emptyAction: 'Add your own file…',
  done: 'Done',
  cancel: 'Cancel',

  /** 上游标的成熟度；`supported` 不标。 */
  status: { experimental: 'Experimental', community: 'Community', testing: 'Testing' },
  chipNonCommercial: 'Non-commercial only',
  /** 许可表写「有条件」「不明」或没有这一族、自己指定的文件：商用前要自己核实。 */
  chipCheckLicense: 'Commercial use unverified',
  options: (n: number) => `${n} options`,
  withParts: (names: readonly string[]) => `Downloads together with ${names.join(', ')}`,
  noPackages: 'No downloadable GGUF upstream yet',
  versionLabel: (name: string) => `Version of ${name}`,
  builtin: 'Built in',
  added: 'Added',
  add: 'Add',

  /** 特点一行（与内置模型行的说法一致）。 */
  traits: {
    clone: 'Voice cloning',
    design: 'Voice from a description',
    voices: (n: number) => (n === 1 ? '1 built-in voice' : `${n} built-in voices`),
    style: 'Style prompt',
    emotion: 'Emotion control',
    lyrics: 'Lyrics',
    instrumental: 'Instrumental',
  },
  /** 语言一句：上游写的不是语言 ID 时的说法。 */
  languages: {
    auto: 'Detects the language',
    count: (n: number) => `${n} languages`,
    atLeast: (n: number) => `${n}+ languages`,
    multilingual: 'Multilingual',
    any: 'Any language',
    modelDependent: 'Depends on the model',
    more: (shown: readonly string[], total: number) => `${shown.join(' / ')} and more (${total} languages)`,
  },
  /** 上游规格的任务名；认不出的照原样写。 */
  tasks: {
    asr: 'Speech recognition',
    vad: 'Voice detection',
    wake_word: 'Wake word',
    classify: 'Sound classification',
    align: 'Text alignment',
    diar: 'Speaker labels',
    vc: 'Voice conversion',
    s2s: 'Spoken dialogue',
    midi: 'To MIDI',
    sfx: 'Sound effects',
    sep: 'Source separation',
    svc: 'Singing voice conversion',
    edit: 'Audio editing',
    turn: 'Turn detection',
    tts: 'Speech',
    clone: 'Voice cloning',
    design: 'Voice design',
    music: 'Music',
  } as Record<string, string>,
  /** 「暂时用不上」那一句：为什么这一族在 BaoCut 里还没地方用。 */
  idle: {
    recognize: 'Transcription keeps using BaoCut’s own recognition models: recognition on audio.cpp is slower and has no speaker labels',
    'separate-slow': 'Separates most cleanly but is much slower, and its license is unclear; use Mel-Band RoFormer for now',
    'separate-stems': 'Splits audio into 6 stems; voice-overs only need vocals and background, so use HTDemucs',
    'separate-speakers': 'Separates several people’s voices, not vocals from background; BaoCut doesn’t use this yet',
    other: (tasks: string) => (tasks ? `${tasks} · BaoCut doesn’t use this yet` : 'BaoCut doesn’t use this yet'),
    'music-request': 'This music model takes different requests from YuE2, which BaoCut doesn’t support yet',
    'engine-route': 'The engine serves this model only for tasks BaoCut doesn’t use yet',
  },
  /** 能添加的分离族那一句：分成什么、跟内置的比；不写速度（各平台差得多）。 */
  sepTraits: {
    htdemucs: 'Vocals and background · a single model, smaller than the built-in HTDemucs-FT',
    mel_band_roformer: 'Vocals and background · cleaner separation than the built-in model',
  } as Record<string, string>,

  /** 「自己指定文件」 */
  sourceLabel: 'Where is the file?',
  sourceRepo: 'On Hugging Face',
  sourceLocal: 'On this computer',
  urlLabel: 'File address',
  urlPlaceholder: 'https://huggingface.co/user/repo/blob/main/model.gguf',
  urlParsed: (repo: string, revision: string, path: string) =>
    `Repo ${repo} · revision ${revision} · file ${path}. Its size and checksum are read when you add it and used to verify the download.`,
  urlHelp: 'Paste the web address of the file, or write it as user/repo/file.gguf. Models made of several files are added from the list.',
  urlErrors: {
    empty: 'Enter a file address',
    'not-hf': 'This address isn’t recognized. Paste the web address of the file on Hugging Face, or write it as user/repo/file.gguf',
    'not-gguf': 'Only .gguf files can be added. Add models made of several files from the list',
  },
  fileLabel: 'File',
  filePlaceholder: 'None chosen',
  fileHelp: 'Used in place: BaoCut reads this file directly without copying or changing it, so it’s ready as soon as it’s added. If you move or delete the file, add it again.',
  fileRequired: 'Choose a .gguf file first',
  chooseFile: 'Choose file…',
  pickTitle: 'Choose a GGUF model file',
  pickFilter: 'GGUF model',
  familyLabel: 'Run it as',
  familyHelp: (about: string) => `${about}. audio.cpp reads the file according to the family you choose; a wrong choice shows up as an error when you check it.`,
  familyHelpNone: 'audio.cpp decides how to read the file by its family.',
  familyRequired: 'Choose a family',
  nameLabel: 'Name (optional)',
  namePlaceholder: 'Uses the file name',
  addLocal: 'Add',
  addRepo: 'Add and download…',

  addedToast: (name: string) => `Added “${name}”`,
  addedInPlaceToast: (name: string) => `Added “${name}” · uses the file where it is, without copying it`,
  addFailed: (text: string) => `Couldn’t add: ${text}`,

  /** 添加进来的模型在行上 */
  chipAdded: 'Added',
  /** 原地引用的本机文件：写明在哪，它不在模型目录里。 */
  inPlace: (path: string) => `Uses ${path} in place · not in the models folder`,
  sourceKey: 'Added from',
  sourceCatalog: (family: string) => `audio.cpp model list · runs as ${family}`,
  sourceRepoFile: (address: string, family: string) => `${address} · runs as ${family}`,
  sourceLocalFile: (family: string) => `A file on this computer · runs as ${family}`,
  unlist: 'Remove from list',
  unlistTitle: (name: string) => `Remove “${name}” from the list?`,
  unlistInPlaceBody: (path: string) => `The file stays at ${path}. BaoCut stops using it and won’t delete it. To use it again, add it again.`,
  unlistConfirm: 'Remove',
  unlistedToast: (name: string) => `Removed “${name}” from the list`,
  unlistedInPlaceToast: (name: string) => `Removed “${name}” from the list · the file wasn’t touched`,
  unlistFailed: (text: string) => `Couldn’t remove it from the list: ${text}`,
  /** 删除添加的、下载过的模型：删完一并移出列表。 */
  removeAddedNote: 'You added this model, so deleting it also removes it from the list. To use it again, add it again.',
  /** 下载确认框里商用待核实的许可：代替「仅限非商用」那一句。 */
  licenseCheckUse: 'Whether it may be used commercially isn’t clear. Read the license before using it in content you plan to use commercially.',
};

export type ModelsAddedMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
