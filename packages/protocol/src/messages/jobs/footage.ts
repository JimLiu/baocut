import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './footage.zh-Hans.ts';
import { zhHant } from './footage.zh-Hant.ts';
import { ja } from './footage.ja.ts';
import { ko } from './footage.ko.ts';
import { es } from './footage.es.ts';
import { fr } from './footage.fr.ts';
import { de } from './footage.de.ts';
import { nl } from './footage.nl.ts';
import { ptBR } from './footage.pt-BR.ts';
import { it } from './footage.it.ts';
import { ru } from './footage.ru.ts';
import { pl } from './footage.pl.ts';
import { tr } from './footage.tr.ts';
import { vi } from './footage.vi.ts';

/** `packages/jobs/src/pipelines/footage.ts` 与 `separate-audio.ts` 给人看的文字。 */
const en = {
  stabilizeLabel: 'Stabilize video',
  stabilizeDescription: 'Steady shaky footage on this computer with ffmpeg (vid.stab when ffmpeg has it, otherwise deshake): file to file, and outputs don\'t overwrite existing files.',
  upscaleLabel: 'Upscale video',
  upscaleDescription: 'Enlarge a video 2–4× on this computer with Real-ESRGAN: file to file, and outputs don\'t overwrite existing files.',
  interpolateLabel: 'Interpolate frames',
  interpolateDescription: 'Make smooth slow motion or a higher frame rate on this computer with RIFE: file to file, and outputs don\'t overwrite existing files.',
  matchColorLabel: 'Match color',
  matchColorDescription: 'Grade videos and images to one reference on this computer with ffmpeg: file to file, and outputs don\'t overwrite existing files.',
  removeBackgroundLabel: 'Remove background',
  removeBackgroundDescription: 'Cut the subject out of videos and images on this computer, no green screen needed: videos come out as ProRes 4444 with alpha, images as PNG.',
  stepProbe: 'Read input',
  stepProcess: 'Process',
  stepVerify: 'Verify output',
  stepPublish: 'Publish',
  paramNotForOp: (p: { op: string }) => `doesn't apply to ${p.op}`,
  endBeforeStart: 'must be after start',
  inputNotFound: (p: { file: string }) => `Can't find input file ${p.file}`,
  inputNotVideo: (p: { name: string }) => `${p.name} isn't a readable video`,
  rangeOnImage: (p: { name: string }) => `${p.name} is an image, so start and end don't apply`,
  inputHdr: (p: { name: string }) => `${p.name} is HDR. These tools work on SDR video; convert it to SDR first.`,
  rangeEmpty: (p: { name: string; duration: string }) => `The range is empty: ${p.name} is ${p.duration} seconds long`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} would come out at ${p.width}×${p.height}; each side can be at most ${p.max} pixels. Choose a smaller scale.`,
  tooFewFrames: (p: { name: string }) => `${p.name} needs at least two frames to interpolate`,
  tooManyFrames: (p: { name: string; frames: number; max: number }) => `${p.name} has about ${p.frames} frames; one run can handle at most ${p.max}. Choose a shorter range.`,
  matteWorkerMissing: 'The background removal program isn\'t available in this build of BaoCut',
  verifyFailed: (p: { name: string }) => `The output for ${p.name} failed verification`,
  toolFailed: (p: { tool: string; name: string; detail: string }) => `${p.tool} couldn't process ${p.name}: ${p.detail}`,
  stabilizeFallback: 'This ffmpeg has no vid.stab (libvidstab), so the built-in deshake filter was used. It only corrects small sideways shake. For stronger stabilization, use an ffmpeg built with libvidstab (for example Homebrew\'s ffmpeg-full) and set BAOCUT_FFMPEG to it.',
  interpolateCuts: 'Frames across a hard cut get blended into ghost images: split the video at its cuts before interpolating.',
  slowmoNoAudio: 'Slow motion has no sound: put the sound on the timeline yourself if you need it.',
  noSubject: (p: { name: string }) => `Almost nothing was recognized as a subject in ${p.name}: check the result`,
  separateLabel: 'Split audio into stems',
  separateDescription: 'Split the first audio track of a file into stems on this computer with a local separation model: file to file, output is WAV, and outputs don\'t overwrite existing files.',
  stepSeparate: 'Separate',
  separateNoAudio: (p: { name: string }) => `${p.name} has no audio track`,
  separateStemsUnsupported: (p: { model: string }) => `${p.model} can only split vocals from the rest; choose an HTDemucs model for drums, bass and other`,
};

export type JobsFootageMessages = typeof en;

export const JobsFootage = defineCatalog('jobsFootage', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
