/*
 * 帮助中心的内置指南（原型 designs/baocut/app/model-help.js）。
 * 来源：baocut-app apps/shared/help/content.json（zh-CN 的 guides 与搜索规则），modified：
 * 逐篇按这个应用现有的功能改写，描述了这里没有的功能的篇目删掉（配音、配音 FAQ、独立工具），
 * 「视频」按术语表写成「视频」。改动清单见 H-a 的报告。
 * 翻译、导出与工具页几篇在功能接上之后补回，照实现写（字幕面板的「生成字幕」「＋ 翻译成…」、视频栏的「导出」、
 * 编辑器里的工具页）；设计稿里有、实现还没有的（双语样式卡、剪映等工程、体积耗时估算、快速修补、智能裁剪）不写。
 *
 * 写进正文的都是界面上现有的入口与文案；经 Agent 完成的步骤（会话里的转写、把转写结果放上时间线、工具页交给 Agent 的整理与写作、
 * 没有可用服务时的说明）依据的是 Agent 工具的说明（runtime-core agent-tools），Agent 实际会不会这样做没有实测（未验证）。
 *
 * 正文在目录里：英文是键与类型的来源，简体中文原文在 `help-guides.zh-Hans.ts`；两种语言的文章结构（篇目、三步、提示、按钮）一致。
 * 英文正文里引号中的界面名照英文界面的说法写；搜索关键词按当前语言各写一份。
 */
import { defineMessages } from '@baocut/protocol';
import { HELP_COPY } from '../copy.ts';
import { zhHans } from './help-guides.zh-Hans.ts';
import { zhHant } from './help-guides.zh-Hant.ts';
import { ja } from './help-guides.ja.ts';
import { ko } from './help-guides.ko.ts';
import { es } from './help-guides.es.ts';
import { fr } from './help-guides.fr.ts';
import { de } from './help-guides.de.ts';
import { nl } from './help-guides.nl.ts';
import { ptBR } from './help-guides.pt-BR.ts';
import { it } from './help-guides.it.ts';
import { ru } from './help-guides.ru.ts';
import { pl } from './help-guides.pl.ts';
import { tr } from './help-guides.tr.ts';
import { vi } from './help-guides.vi.ts';

export type HelpGroup = 'start' | 'guide' | 'faq';

/** 指南按钮去哪（原型 help-center.jsx 的 `navigate`；旧版的意图白名单里这里只保留真能到的几种）。 */
export type HelpAction = 'new' | 'subtitle' | 'style' | 'return' | 'agent' | 'models';

export type HelpIcon =
  | 'upload'
  | 'captions'
  | 'translate'
  | 'export'
  | 'styles'
  | 'workspace'
  | 'elements'
  | 'video'
  | 'agent'
  | 'sparkle'
  | 'help'
  | 'download';

export interface HelpGuide {
  id: string;
  icon: HelpIcon;
  title: string;
  /** 快速上手路径卡上的短名；不在快速上手里的是 null。 */
  short: string | null;
  group: HelpGroup;
  minutes: number;
  summary: string;
  keywords: string;
  steps: readonly (readonly [title: string, body: string])[];
  tip: string;
  action: HelpAction;
  cta: string;
}

type GuideId = 'import' | 'subtitle' | 'translate' | 'export' | 'workspace' | 'style' | 'elements' | 'reframe' | 'aitools' | 'agent' | 'missing' | 'model';

/** 一篇的文字；`cta` 不写时是「回到视频」。 */
type GuideText = Pick<HelpGuide, 'title' | 'short' | 'summary' | 'keywords' | 'steps' | 'tip'> & { cta?: string };

const en = {
  guides: {
    import: {
      title: 'Create a video and import assets',
      short: 'Create and import',
      summary: 'Create a video in Space, then bring assets into the asset library and onto the timeline.',
      keywords: 'new create file asset asset library import drag drop audio image import video asset',
      steps: [
        [
          'Create a video',
          'Open “Space” on the left, click “New” → “New blank video”, choose which project to create it in, then pick an aspect ratio on Home and click “Create blank video”. If you already have a video or audio file, click “New video from file”; Home opens with that file and lets you choose between adding subtitles and transcribing and translating. If you don’t have a project yet, open a project folder in Home first, or ask the Agent in a session to create one for you.',
        ],
        [
          'Import assets into the asset library',
          'In the editor’s right panel, open “Video”, “Audio”, or “Images”, click “Import” and choose files, or drag files into the dashed box. Importing only copies the files into the video folder; the original files aren’t touched.',
        ],
        [
          'Put them on the timeline',
          'Click “+” at the right of an asset row to place it at the playhead. You can also drag an asset to a row on the timeline, or drag a file from your computer straight onto the timeline.',
        ],
      ],
      tip: 'Importing and putting on the timeline are two steps: a newly imported asset sits in the asset library and doesn’t appear in the picture yet.',
      cta: 'New video from file',
    },
    subtitle: {
      title: 'Add subtitles and proofread them line by line',
      short: 'Add subtitles',
      summary: 'Import a subtitle file or have the Agent transcribe, then listen through and make the subtitles accurate.',
      keywords: 'transcribe transcription recognition srt vtt webvtt ass typo split merge find replace transcript subtitle caption',
      steps: [
        [
          'Get subtitles first',
          'Open “Subtitles” on the right. When the video has assets, click “Generate subtitles” to transcribe with an on-device speech model or a connected cloud service; when it’s done, the subtitles go into the picture automatically. The collapsed “Transcription settings” under the button let you change the language, speech model, and recognition hints. If you already have a subtitle file, click “Import subtitle file”; SRT, WebVTT, and ASS are supported. To mark who is speaking, use “Tools › Transcribe”: expand “More options” under the speech model and turn on “Identify speakers”. MOSS Transcribe tells speakers apart on its own, so this stays on; other on-device models need “Speaker diarization”, which you’re prompted to download the first time you turn it on.',
        ],
        [
          'Click a line and edit it',
          'Click a line’s time to move the playhead to it; click the text to edit it. Enter splits it into two lines, Backspace at the start of a line merges it into the previous one, Shift+Enter adds a line break within the line, and Esc discards the edit.',
        ],
        [
          'Listen again, then fix things everywhere at once',
          'After leaving the text box, press Space to play and check the text against the speech. The top of the panel shows how many lines exceed the reading speed. When the same mistake needs fixing in many places, use find and replace (⌘F / Ctrl+F).',
        ],
      ],
      tip: 'Only transcriptions started from “Generate subtitles” go into the picture automatically. When the Agent transcribes in a session, the result is saved as a transcript first; go back to “Subtitles” and click “Generate subtitles” to use it. When the timeline has several subtitle tracks, use the drop-down in the “Subtitles” header to switch to the one you want to edit.',
      cta: 'Open Subtitles',
    },
    translate: {
      title: 'Add a translation for bilingual subtitles',
      short: 'Translation and bilingual',
      summary: 'In the Subtitles panel, choose a target language and a text model; the translation goes into the picture as a new subtitle track.',
      keywords: 'translate translation english chinese bilingual language source side by side glossary text model translate bilingual',
      steps: [
        [
          'Proofread the source first',
          'Translation goes sentence by sentence through the transcribed text, so fix names, terms, and obvious recognition errors first to save edits later. The subtitles you translate must come from a transcription: imported subtitle files have no word timings and can’t be translated directly.',
        ],
        [
          'Click “+ Translate to…” on the track bar',
          'Open “Subtitles” on the right, click “+ Translate to…” on the track bar, choose a target language and a text model, add a style hint or tick a glossary if you need to, then click the start button at the bottom. If no text model is available yet, first connect a service in “Models › Text generation”; online models are billed by token.',
        ],
        [
          'Check the translation and adjust the bilingual layout',
          'When it’s done, the translation goes into the picture automatically, and the receipt card lets you undo it in one click. In “List”, switch to “Source + translation” to compare line by line; click a translated line to rewrite it. Select a subtitle, and the “Bilingual” section in “Subtitle properties” sets which line goes on top and how far apart the two lines are.',
        ],
      ],
      tip: 'Want to show only the translation? Turn off “Bilingual display” before you start, or click the “×” on the source in the track bar to take it out of the picture; the source isn’t deleted. After you edit the source, the affected translations are marked “Outdated”: rewriting one clears the mark. You can also click “Refresh outdated translations” on the outdated notice in the desktop app, or type /refresh in a session, to have the Agent retranslate those lines.',
      cta: 'Open Subtitles',
    },
    export: {
      title: 'Export a video, subtitles, or a transcript',
      short: 'Export',
      summary: 'Pick a deliverable for what you need; for video and audio you can also export just a few chapters or segments.',
      keywords:
        'export save download mp4 wav mp3 m4a srt vtt ass json markdown transcript chapter segment loudness project file premiere davinci resolve portable package export',
      steps: [
        [
          'Click “Export” in the video bar',
          'Click “Export” at the right of the editor’s video bar. Each of the five deliverables has its own page: Video (MP4), Audio (WAV, MP3, or M4A), Subtitles (SRT, VTT, ASS, or JSON), Transcript (Markdown or plain text), and Project file (XML for Premiere Pro and DaVinci Resolve, or a BaoCut portable package).',
        ],
        [
          'Choose a range and confirm the settings',
          'Video and audio can export the whole video, by chapter, by segment, or a custom start and end; subtitles, transcripts, and project files export the whole sequence. On the Video page, also confirm the resolution, file size, and whether to burn subtitles into the picture, and turn on loudness normalization if you need it. On the Subtitles page, tick two tracks to combine them into one bilingual subtitle file.',
        ],
        [
          'Start the export and wait for it to finish',
          'Files are saved to exports/ in the project by default, or click “Choose location” first. You can close the dialog and keep working while it exports; progress shows on the “Export” button, and you can also check it in “Background tasks”. When it’s done, click “Show in Folder” to find the file; if it fails, the dialog says why and what to do next.',
        ],
      ],
      tip: 'A subtitle file and a video with subtitles are two different deliverables: the first is for loading into other software, the second can be played and shared directly.',
    },
    workspace: {
      title: 'Get to know the editor',
      short: null,
      summary: 'See the result in the preview, find moments on the timeline, and change content in the right panel.',
      keywords: 'stage canvas preview timeline panel inspector properties track transport can’t find',
      steps: [
        [
          'Middle: the preview',
          'This shows the picture at the playhead, with the video’s size and frame rate above it. The transport below lets you play, step frame by frame, undo and redo, and split at the playhead.',
        ],
        [
          'Bottom: the timeline',
          'Click the timeline to move the playhead. Drag a clip to change when it appears or move it to another track, and drag its ends to trim it. Right-click a clip to split, copy, disable, or delete it.',
        ],
        [
          'Right: content and properties',
          'From top to bottom, the vertical toolbar has Transcript, Subtitles, Elements, Text, Images, Video, Audio, Brand, and Inspector. Selecting a clip switches to its properties; with nothing selected, the Inspector shows “Video properties” for the whole video.',
        ],
      ],
      tip: 'Made a mistake? Undo first (⌘Z / Ctrl+Z). “Versions” in the video bar opens the history, where you can undo any single edit on its own.',
    },
    style: {
      title: 'Change how subtitles look',
      short: null,
      summary: 'Select a subtitle and change its position, text style, and timing in the Inspector.',
      keywords: 'style font size color outline stroke background shadow glow position bilingual line spacing punctuation style font',
      steps: [
        [
          'Select a subtitle',
          'Click a subtitle on the timeline, and the right panel switches to “Subtitle properties”. What you change here is the subtitle style, so all subtitles that use the same style change together.',
        ],
        [
          'Adjust the position and text style',
          '“Position” sets the vertical and horizontal placement and the width; “Text style” sets the font, size, color, and alignment, and can turn on a background, outline, glow, and shadow. The picture follows while you drag, and the change is saved when you let go.',
        ],
        [
          'Adjust the timing',
          '“Earlier” and “Later” under “Display” set how long before the speech each line appears and how long after it disappears; “Punctuation” can replace commas and periods with spaces.',
        ],
      ],
      tip: 'When the timeline has both source and translated subtitles, “Subtitle properties” gains a “Bilingual” section that sets which line goes on top and how far apart the two lines are. If something goes wrong, undo (⌘Z / Ctrl+Z).',
      cta: 'Open subtitle properties',
    },
    elements: {
      title: 'Add text, stickers, and shapes',
      short: null,
      summary: 'Add things to the picture from the right panel, then adjust their position and style in the Inspector.',
      keywords: 'elements sticker shape visualizer progress bar timer countdown waveform text text box title lower third preset elements sticker shape text',
      steps: [
        [
          'Pick an element',
          '“Elements” on the right is organized into stickers, shapes, and visualizers, and you can search it; visualizers include progress bars, timers, and waveforms. Click one to add it to the timeline: most start at the playhead, while things like progress bars span the whole video.',
        ],
        ['Add text', 'In “Text” on the right, click “Add text box”, or pick one of the presets such as Simple, Title, or Lower third.'],
        [
          'Adjust the timing and position',
          'Each element you add takes up a span on the timeline; drag it to change when it appears. When it’s selected, the right panel shows its properties; use “Geometry” to set its position, size, rotation, and flip by value.',
        ],
      ],
      tip: 'With an element selected, the right panel shows its properties; press Esc to deselect it, and the Inspector goes back to “Video properties”.',
    },
    reframe: {
      title: 'Turn a landscape video into a portrait one',
      short: null,
      summary: 'Change the aspect ratio in Video properties; clips in the picture scale with the canvas.',
      keywords: 'portrait landscape vertical horizontal aspect ratio 9:16 1:1 4:3 16:9 canvas framing reframe vertical aspect',
      steps: [
        ['Open video properties', 'Press Esc to deselect any clip, then open “Inspector” on the right; it now shows “Video properties”.'],
        [
          'Choose a different aspect ratio',
          '“Aspect ratio” offers 16:9, 9:16, 1:1, and 4:3. The short side stays the same; clips in the picture move and scale in proportion with the canvas, clips that fill the canvas still fill it, and locked clips don’t move.',
        ],
        ['Adjust the framing clip by clip', 'Select a clip that needs reframing and adjust its position and size in “Geometry” in its properties.'],
      ],
      tip: 'Changing the aspect ratio is an ordinary edit; if you don’t like it, undo (⌘Z / Ctrl+Z). There’s no smart crop here that finds the key subject automatically, so you adjust the framing yourself.',
    },
    aitools: {
      title: 'Have the Agent tidy up the transcript',
      short: null,
      summary:
        'Polishing, chapters, speakers, finding cuts, translation, voice-over, and writing for publishing start from / in a session or a button in the relevant panel, and go to the Agent by default.',
      keywords:
        'AI tools slash polish paragraph chapter speaker filler pause re-transcribe outdated translation voice-over summary blog title description cover polish chapters speakers cleanup',
      steps: [
        [
          'Type / in a session',
          'Type / at the start of the session input (or choose “Use a tool” under “+”) to list the tools available for this video: Polish transcript, Generate chapters, Identify speakers, Re-transcribe, Find cuts, Translate subtitles, Refresh outdated translations, Translate voice-over, Write a summary, Write a blog post, Suggest titles, Write a description, Make a cover, and Export. Pick one, add your requirements after it, and send it; the Agent starts working. For a video opened from Space, the session is in the lower-right corner; these tools aren’t available on the web.',
        ],
        [
          'Or open it from the relevant panel',
          'The “Tidy transcript” menu at the top right of the Transcript panel has Re-transcribe, Polish transcript, Generate chapters, and Identify speakers, plus Write a summary, Write a blog post, Suggest titles, Write a description, and Make a cover, which start from the transcript; the hint bar in cut mode has “Find cuts”. Click one to open its settings page, choose the range and options, then click “Hand to Agent”; the request is sent straight to this video’s session. Translate subtitles is “+ Translate to…” in the Subtitles panel, and Translate voice-over is in the Audio panel and the voice-over track’s menu; for these two you choose a model on the settings page and start directly.',
        ],
        [
          'Check the results',
          'Each time the Agent changes the video, a change card appears in the session, and you can undo it directly. Polish before generating chapters, so the chapters are grouped by paragraph. Writing and publishing results are for reading, picking, and copying in the session; they don’t change the transcript. After you edit the source, use “Refresh outdated translations” to retranslate only the lines marked “Outdated”.',
        ],
      ],
      tip: 'For anything not on the list, just say it in a sentence in the session. Smart crop and Cut into shorts aren’t available in this version.',
    },
    agent: {
      title: 'Have the Agent work on your video',
      short: null,
      summary: 'Say what you want in one sentence, watch it work step by step, then check the result.',
      keywords: 'AI assistant agent session chat automatic approval permission undo codex claude agent',
      steps: [
        [
          'Connect an Agent first',
          'Open “Settings › Agent providers”. BaoCut detects Claude Code and Codex on this computer; if one isn’t installed, follow the steps on its card to install it and sign in, then come back and detect again.',
        ],
        [
          'Say what you want in a session',
          'Start a session in Home, or open a video in Space: a floating session, expanded by default, sits in the lower-right corner, so just talk there. When minimized, it becomes an icon in the lower-right corner; click it to expand it again. Be clear about the scope and what to keep, for example: “Check the subtitles of this interview for typos, but keep the conversational wording.”',
        ],
        [
          'Watch the process and check the result',
          'Every step the Agent takes can be expanded. Depending on the access mode you chose, it asks you to allow or deny before running commands or making changes; each time it changes the video, a change card appears in the session, and you can undo it directly.',
        ],
      ],
      tip: 'The Agent can only use videos in the session’s folder (the project folder, or the session’s own working folder). When you send a message, such a video open in the editor is attached along with the selection and playhead; you can remove the reference above the input box.',
      cta: 'Open Agent settings',
    },
    missing: {
      title: 'Why can’t I see subtitles in the picture?',
      short: null,
      summary: 'Check, in order, whether the subtitles are on the timeline, where the playhead is, and the track switches.',
      keywords: 'not showing missing hidden disabled blank can’t see subtitles transcription',
      steps: [
        [
          'Make sure the subtitles are on the timeline',
          'Transcriptions made by the Agent or the command line only save the result as a transcript and don’t change the timeline. Open “Subtitles” on the right: if it says “No subtitles yet”, click “Generate subtitles” or import a subtitle file, or ask the Agent to put the transcription on the timeline.',
        ],
        [
          'Go to a line where someone is speaking',
          'Click a line’s time in “Subtitles”, and the playhead jumps to it. Gaps without speech have no subtitles anyway.',
        ],
        [
          'Check the track and clip switches',
          'Look at the track header of the subtitle track: when the eye icon is off, the track isn’t shown in the preview. Disabled clips are also skipped in the picture; right-click one and choose “Enable this clip”.',
        ],
      ],
      tip: 'Still can’t see them? Select the subtitle and check the position and color in “Subtitle properties”: the text may have moved out of the picture, or be too close to the background.',
      cta: 'Check Subtitles',
    },
    model: {
      title: 'Transcription or generation didn’t start. What now?',
      short: null,
      summary: 'First check the reason in Background tasks, then add the missing model service.',
      keywords: 'failed error transcription transcribe speech synthesis image generation model service component network task model',
      steps: [
        [
          'Open Background tasks',
          '“Background tasks” on the left lists every task running in the background, whether it came from the editor, a Home flow, the Agent, or the command line. Click a task’s “Details”: if it failed, the title in the red box is the reason.',
        ],
        [
          'Fill the gap the details point to',
          'The details give a next step based on the reason, such as installing a component, setting up a cloud model, choosing a default model, or checking the Agent settings.',
        ],
        [
          'Go back and try again',
          'Once that’s fixed, go back and try again: click “Generate subtitles” again in the Subtitles panel, or ask the Agent in the session to resubmit. When no service is available, the Agent first tells you which one to turn on.',
        ],
      ],
      tip: 'Transcription, speech synthesis, and image generation all need a model service. Help can be read offline, but cloud services need a network connection.',
      cta: 'View models',
    },
  } as Record<GuideId, GuideText>,
};
export type HelpGuidesMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 篇目与次序（文字在目录里）：`[id, 图标, 分组, 分钟, 按钮去处]`。 */
const GUIDES: readonly (readonly [GuideId, HelpIcon, HelpGroup, number, HelpAction])[] = [
  ['import', 'upload', 'start', 1, 'new'],
  ['subtitle', 'captions', 'start', 2, 'subtitle'],
  ['translate', 'translate', 'start', 2, 'subtitle'],
  ['export', 'export', 'start', 2, 'return'],
  ['workspace', 'workspace', 'guide', 1, 'return'],
  ['style', 'styles', 'guide', 2, 'style'],
  ['elements', 'elements', 'guide', 2, 'return'],
  ['reframe', 'video', 'guide', 1, 'return'],
  ['aitools', 'sparkle', 'guide', 2, 'return'],
  ['agent', 'agent', 'guide', 2, 'agent'],
  ['missing', 'help', 'faq', 1, 'subtitle'],
  ['model', 'download', 'faq', 1, 'models'],
];

export const HELP_GUIDES: readonly HelpGuide[] = GUIDES.map(([id, icon, group, minutes, action]) => ({
  id,
  icon,
  group,
  minutes,
  action,
  get title() {
    return M.guides[id].title;
  },
  get short() {
    return M.guides[id].short;
  },
  get summary() {
    return M.guides[id].summary;
  },
  get keywords() {
    return M.guides[id].keywords;
  },
  get steps() {
    return M.guides[id].steps;
  },
  get tip() {
    return M.guides[id].tip;
  },
  get cta() {
    return M.guides[id].cta ?? HELP_COPY.backToVideo;
  },
}));

/** 快速上手页「你可能还想了解」列的两篇（原型 help-center.jsx）。 */
export const HELP_MORE: readonly string[] = ['workspace', 'agent'];

/** 快速上手的几篇，按目录次序。 */
export function quickStart(guides: readonly HelpGuide[] = HELP_GUIDES): HelpGuide[] {
  return guides.filter((guide) => guide.group === 'start');
}

/**
 * 搜索（原型 model-help.js 的 `search`）：按空白分词、不分大小写，每个词都要出现在标题、短名、摘要、关键词、
 * 提示或步骤里。原型把可能为 null 的短名直接拼进去（搜「null」会全中），这里跳过空值。
 */
export function searchGuides(query: string, guides: readonly HelpGuide[] = HELP_GUIDES): HelpGuide[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return guides.filter((guide) => {
    const text = [guide.title, guide.short, guide.summary, guide.keywords, guide.tip, ...guide.steps.flat()]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

/** 按钮落到哪：`new` 打开首页（从输入框的「+」或拖放加素材），`space` 去 Space（选视频），`subtitle` 打开编辑器的字幕页，`close` 只关帮助回到视频。 */
export type HelpTarget = 'new' | 'space' | 'agent' | 'models' | 'subtitle' | 'close';

export interface HelpCta {
  label: string;
  target: HelpTarget;
  /** 这篇要在视频里做，而现在没开视频：按钮换成「选择一个视频」。 */
  needsVideo: boolean;
}

/**
 * 文章底部的按钮（原型 help-center.jsx 的 `cta` 与 `navigate`）。只做这里真能到的：
 * - `new` 打开首页（原型 help-center.jsx `newProject({entry: 'media'})`，不带目标）；`agent` 去设置 › Agent 提供方；`models` 去模型页。
 * - 要在视频里做的（字幕、样式、回到视频）：没开视频时换成「选择一个视频」去 Space。
 * - `style`：字幕属性要先在时间线上选中一段字幕才有，帮助打不开它，按钮换成「回到视频」。
 */
export function helpCta(guide: HelpGuide, inVideo: boolean): HelpCta {
  const plain = (target: HelpTarget, label = guide.cta): HelpCta => ({ label, target, needsVideo: false });
  switch (guide.action) {
    case 'new':
      return plain('new');
    case 'agent':
      return plain('agent');
    case 'models':
      return plain('models');
    case 'subtitle':
    case 'style':
    case 'return':
      if (!inVideo) return { label: HELP_COPY.pickVideo, target: 'space', needsVideo: true };
      if (guide.action === 'subtitle') return plain('subtitle');
      return plain('close', HELP_COPY.backToVideo);
  }
}
