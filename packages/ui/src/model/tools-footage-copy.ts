import { defineMessages } from '@baocut/protocol';
import { zhHans } from './tools-footage-copy.zh-Hans.ts';
import { zhHant } from './tools-footage-copy.zh-Hant.ts';
import { ja } from './tools-footage-copy.ja.ts';
import { ko } from './tools-footage-copy.ko.ts';
import { es } from './tools-footage-copy.es.ts';
import { fr } from './tools-footage-copy.fr.ts';
import { de } from './tools-footage-copy.de.ts';
import { nl } from './tools-footage-copy.nl.ts';
import { ptBR } from './tools-footage-copy.pt-BR.ts';
import { it } from './tools-footage-copy.it.ts';
import { ru } from './tools-footage-copy.ru.ts';
import { pl } from './tools-footage-copy.pl.ts';
import { tr } from './tools-footage-copy.tr.ts';
import { vi } from './tools-footage-copy.vi.ts';

type Tool = 'stabilize-video' | 'upscale-video' | 'interpolate-video' | 'match-color' | 'remove-background' | 'separate-audio';
type Managed = 'realesrgan-ncnn-vulkan' | 'rife-ncnn-vulkan' | 'matte-models' | 'matte-models-isnet';
type Card = { name: string; sub: string };

/** 素材处理工作台（去抖、超分、插帧、统一色调、去除背景、分轨）的文案（译文在 `tools-footage-copy.<语言>.ts`）。 */
const en = {
  lede: {
    'stabilize-video': 'Steady shaky handheld footage with ffmpeg on this computer. Nothing to download.',
    'upscale-video': 'Enlarge a video 2–4× with Real-ESRGAN on this computer, adding estimated detail.',
    'interpolate-video': 'Make smooth slow motion or a higher frame rate with RIFE on this computer.',
    'match-color': 'Bring the color of several clips or images in line with one reference, using ffmpeg on this computer.',
    'remove-background': 'Cut the subject out without a green screen. Videos come out as MOV with transparency, images as PNG.',
    'separate-audio': 'Split the first audio track of an audio or video file into vocals and accompaniment, and optionally drums, bass and other.',
  } satisfies Record<Tool, string>,
  verb: {
    'stabilize-video': 'Stabilize',
    'upscale-video': 'Upscale',
    'interpolate-video': 'Interpolate',
    'match-color': 'Match color',
    'remove-background': 'Remove background',
    'separate-audio': 'Split audio',
  } satisfies Record<Tool, string>,
  chipLocal: 'Processed on this computer · nothing uploaded',
  unavailable: 'Can’t be used right now',

  // 输入
  filesTitle: 'Files',
  clear: 'Clear',
  dropTitle: {
    'stabilize-video': 'Drop video files here',
    'upscale-video': 'Drop video files here',
    'interpolate-video': 'Drop video files here',
    'match-color': 'Drop video files or images here',
    'remove-background': 'Drop video files or images here',
    'separate-audio': 'Drop audio or video files here',
  } satisfies Record<Tool, string>,
  dropSub: (max: number) => `Up to ${max} at a time, each processed with the same settings. The originals aren’t changed.`,
  pick: 'Choose files…',
  addMore: 'Add more',
  pickTitle: 'Choose files',
  mediaFilter: 'Video, audio and images',
  spaceAdd: 'Choose from Space…',
  spaceDone: 'Done choosing',
  remove: 'Remove',
  reading: 'Reading…',
  notAccepted: {
    'stabilize-video': 'This tool only takes video files',
    'upscale-video': 'This tool only takes video files',
    'interpolate-video': 'This tool only takes video files',
    'match-color': 'This tool only takes video files and images',
    'remove-background': 'This tool only takes video files and images',
    'separate-audio': 'This tool only takes audio and video files',
  } satisfies Record<Tool, string>,
  unreadable: (name: string) => `Can’t read ${name}: it may be missing or not a media file`,
  tooManyInputs: (max: number) => `Up to ${max} at a time; the rest weren’t added`,
  noPath: 'Can’t get this file’s path. Use “Choose files…” instead.',
  sameSettings: (n: number) => `${n} files · each processed with the same settings`,
  sourceImage: (width: number, height: number) => `Image · ${width}×${height}`,
  sourceFrames: (n: string) => `${n} frames`,
  sourceFramesInRange: (n: string) => `${n} frames in this range`,
  sourceNoAudio: 'no audio track',
  sourceSpace: 'Space',

  // 处理哪一段
  rangeTitle: 'Which part',
  rangeAll: 'All of it',
  rangePart: 'One part',
  rangeAllNote: 'Processes the whole file. When a file has several shots, or your timeline only uses part of it, process just that part.',
  rangeFrom: 'From',
  rangeTo: 'To',
  rangeFirst: (label: string) => `First ${label}`,
  rangeSeconds: (n: number) => `${n} sec`,
  rangeMinutes: (n: number) => `${n} min`,
  rangeOne: (time: string, frames: string) => `${time} · ${frames} frames.`,
  rangeMany: 'The same part of each file.',
  rangeRule: 'Times are in the source file; an end past the file’s end stops at the end.',

  // 去抖
  strengthTitle: 'Stabilization strength',
  strength: 'Strength',
  strengthLevel: { low: 'Light', medium: 'Medium', high: 'Strong' },
  strengthNote: 'Stronger is steadier, and crops more of the picture. Sound is kept.',
  vidstabNote: 'This ffmpeg has vid.stab: it detects the motion first, then corrects it, in two passes.',
  deshakeNote: 'This ffmpeg has no vid.stab (libvidstab), so the built-in deshake filter will be used. It only corrects small sideways shake. For stronger stabilization, use an ffmpeg built with libvidstab (for example Homebrew’s ffmpeg-full) and set BAOCUT_FFMPEG to it.',

  // 超分
  upscaleTitle: 'How much to enlarge',
  scale: 'Scale',
  upscaleModel: {
    video: { name: 'Video (fast)', sub: 'A light model made for video, native 2×, 3× and 4×' },
    photo: { name: 'Live action', sub: 'Much slower; native 4×' },
    anime: { name: 'Animation', sub: 'Animation and line art, much slower; native 4×' },
  } satisfies Record<'video' | 'photo' | 'anime', Card>,
  upscaleModelLabel: 'Weights',
  nativeNote: 'The model does this scale natively.',
  resizeNote: (scale: number) => `These weights are natively 4×: enlarged 4×, then scaled down to ${scale}×.`,
  upscaleCaveat: 'Upscaling estimates detail and can’t recover what wasn’t captured: text and faces may change. Sound is copied as is; the output is H.264.',

  // 插帧
  interpolateTitle: 'What to make',
  modeLabel: 'Mode',
  mode: {
    slowmo: { name: 'Slow motion', sub: 'Same frame rate, longer by the factor; no sound' },
    smooth: { name: 'Higher frame rate', sub: 'Same length, frame rate times the factor; sound is kept' },
  } satisfies Record<'slowmo' | 'smooth', Card>,
  factor: 'Factor',
  slowmoLine: (fps: string, from: string, to: string) => `${fps} fps · ${from} → ${to}`,
  smoothLine: (from: string, to: string) => `${from} → ${to} fps · same length`,
  cutsNote: 'Frames across a hard cut get blended into ghost images: when a file has several shots, process each shot separately.',

  // 统一色调
  referenceTitle: 'Reference to match',
  required: 'Required',
  referencePick: 'Choose a reference…',
  referenceFromInputs: 'Or use one of these:',
  referenceReplace: 'Replace',
  referenceImage: (width: number, height: number) => `Image · ${width}×${height}`,
  referenceVideo: (time: string, width: number, height: number) => `Video file · ${time} · ${width}×${height}`,
  referenceAt: 'Frame at',
  referenceAtNote: 'Leave empty to use the middle.',
  methodTitle: 'How to match',
  methodLabel: 'Method',
  method: {
    'hm-mkl-hm': { name: 'Standard', sub: 'Best in most cases' },
    mkl: { name: 'Safe', sub: 'Matches mean and covariance; least likely to show color bands' },
    reinhard: { name: 'Gentle', sub: 'Matches mean and variance; changes the least' },
    histogram: { name: 'Per channel', sub: 'Matches each channel’s distribution; can shift the color' },
  } satisfies Record<'hm-mkl-hm' | 'mkl' | 'reinhard' | 'histogram', Card>,
  amount: 'Strength',
  amountLabel: 'Blend with the original color',
  amountNote: 'Lower to 50–80% if it’s too much. This is burned into a new file, not an adjustable effect on the timeline, and it only moves color: it can’t restore detail lost to underexposure. When a file has several shots, process each separately, or the sample mixes them.',

  // 去除背景
  matteTitle: 'Which weights',
  matteLabel: 'Background removal weights',
  matte: {
    fast: { name: 'Fast', sub: 'U²-Net · about 0.25 s per frame · Apache-2.0' },
    general: { name: 'Cleaner', sub: 'IS-Net · about 4× slower · about 180 MB more to download · non-commercial only' },
  } satisfies Record<'fast' | 'general', Card>,
  licenseNote: 'IS-Net’s weights are for non-commercial research and education only: the code is Apache-2.0, but the weights have no license of their own and their training set, DIS5K, only allows non-commercial use. Ask the authors before commercial use, or switch back to Fast.',
  temporal: 'Reduce flicker',
  temporalLabel: 'Blend with the previous frame',
  temporalNote: 'How much to blend with the previous frame. Raise it if the edges flicker. Not used for images.',
  matteNote: 'No green screen needed, but it only finds prominent subjects. Runs on the CPU. Videos come out as ProRes 4444 MOV with transparency, and those files are large; images come out as PNG.',

  // 分轨
  modelNoun: 'separation model',
  modelManage: 'Manage models…',
  modelLocalNote: 'Local models run on this computer and upload nothing.',
  modelDownloadBody: 'Used to split audio into stems. Translated voice-over uses the same model.',
  modelDownloadBodyPaused: 'The download stopped partway. Continue from where it left off.',
  stemsTitle: 'How many stems',
  stemsLabel: 'Stems',
  stems: {
    vocals: { name: 'Vocals and accompaniment', sub: 'Two WAVs: -vocals and -background' },
    four: { name: 'Also drums, bass and other', sub: 'Five WAVs: adds -drums, -bass and -other. HTDemucs models only' },
  } satisfies Record<'vocals' | 'four', Card>,
  stemsUnsupported: (model: string) => `${model} can only split vocals from the rest; choose an HTDemucs model for drums, bass and other`,
  separateNote: 'Uses the first audio track only. Translated voice-over already separates audio, so you don’t need this first. To cut to the beat, analyze -drums.wav: it’s more accurate than the mix.',

  // 第一次使用
  gateTitle: (name: string) => `Download ${name} first`,
  firstUse: 'First use',
  toolName: {
    'realesrgan-ncnn-vulkan': 'Real-ESRGAN',
    'rife-ncnn-vulkan': 'RIFE',
    'matte-models': 'background removal weights (U²-Net)',
    'matte-models-isnet': 'background removal weights (IS-Net)',
  } satisfies Record<Managed, string>,
  toolBody: {
    'realesrgan-ncnn-vulkan': 'An open source upscaler that runs on this computer’s GPU, with no network use and no uploads. It’s the same copy image upscaling uses, so one install covers both.',
    'rife-ncnn-vulkan': 'An open source frame interpolator that runs on this computer’s GPU, with no network use and no uploads. The release includes a dozen older models, which is why the download is about 430 MB; BaoCut only unpacks the program and the rife-v4.6 model, about 40 MB.',
    'matte-models': 'Weights published by the rembg project. It’s only a model file, run on this computer’s CPU by the background removal program included with BaoCut, with nothing uploaded.',
    'matte-models-isnet': 'Weights published by the rembg project. It’s only a model file, run on this computer’s CPU by the background removal program included with BaoCut, with nothing uploaded. It’s downloaded separately from the default weights because its license differs.',
  } satisfies Record<Managed, string>,
  toolKeep: 'BaoCut keeps it in its own tools folder and changes nothing else on your system.',
  factVersion: (version: string) => `Version ${version}`,
  factSize: (size: string) => `About ${size}`,
  factSizeRife: (size: string) => `Download about ${size} · about 40 MB once unpacked`,
  factLicense: (license: string) => `License: ${license}`,
  install: (size: string) => `Download and install (about ${size})`,
  offlineNote: 'Strict offline mode is on, so external tools aren’t downloaded.',
  installChecksum: 'Verified with SHA-256 after downloading',
  installFailed: (reason: string) => `The download didn’t finish: ${reason}`,
  recheck: 'Check again',
  downloading: (percent: number) => `Downloading and verifying… ${percent}%`,
  downloadingNoPercent: 'Downloading and verifying…',
  leaveNote: 'This continues if you leave the page.',
  cancel: 'Cancel',
  licenseAck: 'I understand these weights are for non-commercial research and education only',
  backToFast: 'Switch back to Fast',
  pickProgram: 'Use a copy on this computer…',
  pickProgramTitle: 'Choose the program',
  pickFolder: 'Use a folder on this computer…',
  pickFolderTitle: 'Choose the folder that holds the weights',
  pickFailed: (reason: string) => `That copy can’t be used: ${reason}`,

  // 这一次要多久
  loadTitle: 'How long this takes',
  tryShort: 'Try 10 seconds first',
  loadInput: 'To process',
  loadOutput: 'Output',
  loadEta: 'Estimated time',
  frames: (n: string) => `${n} frames`,
  images: (n: number) => `${n} ${n === 1 ? 'image' : 'images'}`,
  filesCount: (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`,
  wavs: (n: number) => `${n} WAV ${n === 1 ? 'file' : 'files'}`,
  loadSource: (time: string, fps: string) => `${time} · ${fps} fps`,
  loadOutputDetail: (width: number, height: number, fps: string, time: string) => `${width}×${height} · ${fps} fps · ${time}`,
  diskLine: (out: string, scratch: string) => `The result is about ${out}, and processing uses about ${scratch} of temporary space.`,
  longNote: 'This will take a while.',
  veryLongNote: 'This will take a long time, and the computer has to stay on until it finishes.',
  longAdvice: 'Process only the part you actually use, or try 10 seconds first to see the result.',
  rateMeasuredCpu: 'A rough estimate from measured speed per frame. It runs on the CPU, and other computers may take several times longer.',
  rateMeasuredSeparate: 'A rough estimate from measured separation speed. Other computers may take several times longer.',
  rateEstimated: 'A rough estimate. Actual time can differ several times over between computers.',
  rateAfter: 'Updated from the actual speed once it starts. One task runs at a time, and it continues if you leave the page.',
  queueNote: 'One task runs at a time, and it continues if you leave the page.',
  etaSeconds: 'a few seconds',
  etaUnderMinute: 'under a minute',
  etaUnderMinutes: (to: number) => `under ${to} min`,
  etaMinutes: (from: number, to: number) => `about ${from}–${to} min`,
  etaHours: (from: number, to: number) => `about ${from}–${to} hours`,
  leftUnderMinute: 'under a minute left',
  leftMinutes: (n: number) => `about ${n} min left`,
  leftHours: (n: string) => `about ${n} hours left`,

  // 开始前的检查
  chooseFirst: {
    'stabilize-video': (max: number) => `Choose a video file (up to ${max})`,
    'upscale-video': (max: number) => `Choose a video file (up to ${max})`,
    'interpolate-video': (max: number) => `Choose a video file (up to ${max})`,
    'match-color': (max: number) => `Choose a video file or image (up to ${max})`,
    'remove-background': (max: number) => `Choose a video file or image (up to ${max})`,
    'separate-audio': (max: number) => `Choose an audio or video file (up to ${max})`,
  } satisfies Record<Tool, (max: number) => string>,
  inputHdr: (name: string) => `${name} is HDR. These tools work on SDR video; convert it to SDR first.`,
  inputNoAudio: (name: string) => `${name} has no audio track`,
  rangeOnImage: (name: string) => `${name} is an image, so you can’t process just a part: remove the image or switch back to all of it`,
  endBeforeStart: 'The end has to be after the start',
  rangeEmpty: (name: string, duration: string) => `This part is empty: ${name} is ${duration} seconds long`,
  outputTooLarge: (name: string, width: number, height: number, max: number) => `${name} would come out at ${width}×${height}; each side can be at most ${max} pixels. Choose a smaller scale.`,
  tooFewFrames: (name: string) => `${name} needs at least two frames to interpolate`,
  tooManyFrames: (name: string, frames: string, max: string) => `${name} has about ${frames} frames; one run can handle at most ${max}. Choose a shorter part.`,
  pickReference: 'Choose a reference: an image or a video',
  downloadFirst: (name: string, size: string) => `Download ${name} first · about ${size}`,

  // 记录
  side: 'Task queue',
  empty: 'Nothing processed yet',
  emptyBody: 'Choose files and press the button; progress shows up here.',
  sideFoot: 'Each input becomes a new file and an item in Space; the originals aren’t changed. All six tools share this queue, and one runs at a time.',
  submitted: 'Started',
  submitFailed: (reason: string) => `Couldn’t start: ${reason}`,
  againDone: 'Filled in with that run’s files and settings',
  progress: 'Progress',
  moreFiles: (name: string, n: number) => `${name} and ${n} more`,
  metaStrength: (level: string) => `Strength: ${level}`,
  metaReference: (method: string, percent: number, name: string) => `${method} · ${percent}% · reference ${name}`,
  framesProgress: (done: string, total: string) => `${done} / ${total} frames`,
  outputsSaved: (n: number, dir: string) => `${n} files · saved in ${dir}`,
  licenseResult: 'Made with IS-Net’s weights: for non-commercial research and education only.',
  saveNote: {
    'stabilize-video': 'Saved as <name>-stabilized.mp4, also an item in Space. The original isn’t changed; same names get a number.',
    'upscale-video': 'Saved as <name>-upscaled-<scale>x.mp4, also an item in Space. The original isn’t changed; same names get a number.',
    'interpolate-video': 'Saved as <name>-slowmo-<factor>x.mp4 or <name>-smooth-<factor>x.mp4, also an item in Space. The original isn’t changed; same names get a number.',
    'match-color': 'Saved as <name>-color-matched.mp4 (images as PNG), also an item in Space. The original isn’t changed; same names get a number.',
    'remove-background': 'Saved as <name>-cutout.mov (images as PNG with transparency), also an item in Space. The original isn’t changed; same names get a number.',
    'separate-audio': 'Each stem is a WAV named <name>-<stem>.wav, also an audio item in Space. The original isn’t changed; same names get a number.',
  } satisfies Record<Tool, string>,

  // 目录卡片
  cardFfmpeg: 'Uses ffmpeg on this computer · nothing to download',
  cardFirstUse: (name: string, size: string) => `Downloads ${name} (about ${size}) on first use`,
  cardReady: (name: string) => `${name} ready`,
  cardSeparateMissing: 'Downloads a separation model on first use',
};

export type FootageMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
