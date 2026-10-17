import { defineMessages, live, type SkillVersionKind } from '@baocut/protocol';
import { revealLabel } from '../../copy.ts';
import type { AssetKind } from '../../model/skills-page.ts';
import { zhHans } from './skills-copy.zh-Hans.ts';
import { zhHant } from './skills-copy.zh-Hant.ts';
import { ja } from './skills-copy.ja.ts';
import { ko } from './skills-copy.ko.ts';
import { es } from './skills-copy.es.ts';
import { fr } from './skills-copy.fr.ts';
import { de } from './skills-copy.de.ts';
import { nl } from './skills-copy.nl.ts';
import { ptBR } from './skills-copy.pt-BR.ts';
import { it } from './skills-copy.it.ts';
import { ru } from './skills-copy.ru.ts';
import { pl } from './skills-copy.pl.ts';
import { tr } from './skills-copy.tr.ts';
import { vi } from './skills-copy.vi.ts';

/** Skills 页（rail 上 Space 下面一格，产品设计 §6.9）的文案；译文在 `skills-copy.<语言>.ts`。 */
const en = {
  list: {
    title: 'Skills',
    lede: 'A skill teaches the Agent to do things your way: a SKILL.md plus reference files and assets (logos, stamps, intro music, fonts). Skills that are on are used by the Agent on its own when relevant; skills that are off are used only when you pick them from “+” in the input box.',
    search: 'Search skills',
    mine: 'Mine',
    brands: 'Project brands',
    builtin: 'Built into BaoCut',
    count: (n: number) => String(n),
    emptyMineTitle: 'No skills of your own yet',
    emptyMineBody:
      'Pack your way of working and your assets into a skill: show name, slogan, logo, stamp, intro music, voice. Once uploaded, the Agent follows it every time.',
    noMatch: (query: string) => `Nothing matches “${query}”`,
    none: 'None',
    webNote: 'In the browser you can view skills and BRAND.md and turn skills on or off; upload, import, create, edit, download and remove them in the BaoCut desktop app.',
    view: (name: string) => `View ${name}`,
    enable: (name: string) => `Enable ${name}`,
    more: (name: string) => `More actions for ${name}`,
    dropTitle: 'Drop to upload a skill',
    dropHint: 'A zip or a folder with SKILL.md at its root',
    external: 'Use BaoCut from Agents in a terminal or other apps',
    externalHint: 'Install the BaoCut skill for them',
  },
  badge: {
    fresh: 'New',
    assets: (n: number) => `${n} ${n === 1 ? 'asset' : 'assets'}`,
    github: 'GitHub',
    brand: 'BRAND.md',
  },
  add: {
    label: 'Add',
    upload: 'Upload a zip or folder',
    uploadHint: 'SKILL.md and its assets come in together',
    github: 'Import from GitHub',
    blank: 'New skill',
    blankHint: 'Start from a SKILL.md template',
    agent: 'Create with the Agent',
    agentHint: 'Describe how you work and the Agent writes it up as a skill',
    agentPrompt:
      'Help me write a skill: the logo, stamp, opening line and voice I use in every video. I’ll send you the requirements and the assets. Write it in this session’s folder as a skill folder (a SKILL.md with name and description, assets under assets/), and tell me where it is so I can upload it on the Skills page.',
  },
  menu: {
    label: 'More actions',
    try: 'Try it',
    edit: 'Edit',
    download: 'Download',
    downloadHint: 'Packs it as a zip with every file and asset',
    get reveal() {
      return revealLabel();
    },
    duplicate: 'Duplicate',
    duplicateBuiltin: 'Built-in skills can’t be changed; duplicate one into “Mine” and change that',
    duplicateHint: 'Adds a separate copy in “Mine” you can change on its own',
    remove: 'Remove',
    removeHint: 'Removes it from BaoCut, along with its assets',
    removeBuiltin: 'Built-in skills can’t be removed, but you can turn them off',
  },
  toast: {
    on: (name: string) => `Turned on “${name}”: the Agent uses it on its own when relevant`,
    off: (name: string) => `Turned off “${name}”: used only when you pick it from “+” in the input box`,
    duplicated: (name: string) => `Copied to “Mine” as “${name}”; you can change it now`,
    removed: (name: string) => `Removed “${name}”`,
    downloaded: (path: string) => `Saved to ${path}`,
    saved: (revision: number) => `Saved as version ${revision}`,
    restored: (from: number, to: number) => `Restored version ${from} as version ${to}`,
    created: (name: string, path: string) => `Created “${name}” in ${path}`,
    imported: (name: string, path: string) => `Imported “${name}” into ${path}; it’s off until you turn it on`,
  },
  removeDialog: {
    title: (name: string) => `Remove “${name}”?`,
    body: (path: string) => `This deletes the folder ${path} with every file and version in it, and can’t be undone. Sessions already running aren’t affected.`,
    confirm: 'Remove',
    cancel: 'Cancel',
  },
  detail: {
    back: 'Skills',
    notFoundTitle: 'Can’t find this skill',
    notFoundBody: 'It may have been removed. Go back to Skills to see the others.',
    tabsLabel: 'Skill details',
    overview: 'Overview',
    files: (n: number) => `Files ${n}`,
    tryIt: 'Try it',
    version: (n: number) => `Version ${n}`,
    stateOn: 'On: the Agent uses it on its own when relevant.',
    stateOff: 'Off: used only when you pick it from “+” in the input box.',
    thirdPartyNote:
      'Third-party skills come from repositories other people share: look through one before turning it on. BaoCut never runs any file in a skill, and a skill can’t widen an Agent’s permissions.',
    assets: 'Assets',
    assetsHint: 'When the Agent uses this skill, it can put these assets straight into videos. To change them, edit this skill or upload a new version.',
    assetKind: { image: 'image', audio: 'audio', video: 'video', font: 'font' } as Record<AssetKind, string>,
    assetCount: (n: number, kind: string) => `${n} ${kind}${n === 1 ? '' : 's'}`,
    viewAsset: (path: string) => `View ${path}`,
    howTitle: 'How the Agent decides to use it',
    howHint: 'This is the description at the top of SKILL.md. When the Agent sees it relates to what you asked, it uses this skill.',
    info: 'Info',
    source: 'Source',
    author: 'Author',
    sourceLabel: { builtin: 'Built into BaoCut', personal: 'Mine', 'third-party': 'GitHub' } as Record<string, string>,
    updated: 'Updated',
    filesInfo: (n: number, size: string) => `${n} ${n === 1 ? 'file' : 'files'} · ${size}`,
    location: 'Location',
    from: 'From',
    scripts: (n: number) =>
      `Includes ${n} ${n === 1 ? 'script' : 'scripts'}. BaoCut never runs them; it only reads the text and uses the assets. When Agents in a terminal or other apps use this skill, they may run.`,
    viewFiles: (n: number) => `View ${n} ${n === 1 ? 'file' : 'files'}`,
  },
  files: {
    tree: 'Files',
    pick: 'Pick a file.',
    previewMode: 'Show as',
    preview: 'Preview',
    source: 'Source',
    asset: 'Asset',
    script: 'Script',
    scriptNote: 'Script. BaoCut never runs it; when Agents in a terminal or other apps use this skill, it may run.',
    binary: (kind: string, size: string) => `${kind} · ${size} · not previewed here`,
    kind: { image: 'Image', audio: 'Audio', video: 'Video', font: 'Font', other: 'File' } as Record<string, string>,
    tooLarge: 'Too large to show here.',
    loading: 'Loading…',
    loadFailed: (message: string) => `Couldn’t load: ${message}`,
    frontMatter: 'Metadata at the top of the file',
    editLabel: (path: string) => `Edit ${path}`,
    versionPicker: 'Version',
    versionItem: (n: number, current: boolean) => (current ? `Version ${n} · current` : `Version ${n}`),
    versionKind: {
      create: 'Created',
      upload: 'Uploaded',
      edit: 'Edited in BaoCut',
      restore: 'Restored',
      duplicate: 'Duplicated',
      import: 'Imported',
    } as Record<SkillVersionKind, string>,
    builtinBar: 'Built into BaoCut · updated with BaoCut',
    thirdPartyBar: 'From GitHub · import again to update',
    download: 'Download',
    duplicateToEdit: 'Duplicate to edit',
    edit: 'Edit',
    restore: 'Restore this version',
    oldVersion: (n: number, next: number) => `Viewing version ${n}, read-only. Restoring saves it as version ${next}; the current version stays.`,
    addFiles: 'Add files',
    removeFile: 'Delete this file',
    notePlaceholder: 'What changed (optional)',
    noteLabel: 'What changed',
    cancel: 'Cancel',
    save: (n: number) => `Save as version ${n}`,
    saveBrand: 'Save',
    discardTitle: 'Discard your changes?',
    discardBody: (n: number) => `Your changes aren’t saved. Discarding goes back to version ${n}.`,
    discardBrandBody: 'Your changes aren’t saved; the BRAND.md in the project stays as it is.',
    discard: 'Discard changes',
    keep: 'Keep editing',
    leaveTitle: 'Leave without saving?',
  },
  upload: {
    title: 'Upload a skill',
    pickZip: 'Choose a zip',
    pickFolder: 'Choose a folder',
    intro: 'A skill is a folder with a SKILL.md at its root. A zip or folder with several skill folders inside lets you pick which to add.',
    zipFilter: 'Zip archive',
    reading: 'Reading the package…',
    ignored: (list: string) => `Skipped system and hidden files: ${list}`,
    candidates: 'Skills in this package',
    meta: (files: number, size: string) => `${files} ${files === 1 ? 'file' : 'files'} · ${size}`,
    assets: (n: number) => `${n} ${n === 1 ? 'asset' : 'assets'}`,
    scripts: (n: number) => `${n} ${n === 1 ? 'script' : 'scripts'}`,
    scriptsNote: 'Some of these include scripts. BaoCut never runs them; when Agents in a terminal or other apps use the skill, they may run.',
    conflictPersonal: (id: string, next: number) => `You already have “${id}”. Update it to version ${next} (old versions are kept), or save this as a copy.`,
    conflictOther: (id: string, copy: string) => `“${id}” is already taken by a built-in or GitHub skill. It will be saved as a copy, “${copy}”.`,
    modeLabel: 'When the name is taken',
    update: (next: number) => `Update to version ${next}`,
    copy: (id: string) => `Save as a copy (${id})`,
    install: (n: number) => (n === 1 ? 'Add 1 skill' : `Add ${n} skills`),
    installing: 'Adding…',
    cancel: 'Cancel',
    close: 'Done',
    doneTitle: 'Added',
    doneLine: (name: string, path: string) => `“${name}” is in ${path}`,
    issue: {
      'no-description': 'SKILL.md has no description at the top. Add a sentence or two on what it does and when to use it; the Agent relies on it.',
      'too-many-files': 'Too many files for one skill.',
      'too-large': 'Too large for one skill.',
      'unsafe-path': 'A path points outside the package, so it can’t be added.',
      invalid: 'This isn’t a usable skill.',
    } as Record<string, string>,
  },
  blank: {
    title: 'New skill',
    name: 'Name',
    namePlaceholder: 'e.g. Morning show brand',
    when: 'When should the Agent use it?',
    whenPlaceholder: 'A sentence or two: what it does, and what the user says when it applies',
    whenDefault: 'Write a sentence or two: what it does, and what the user says when it should be used.',
    create: 'Create',
    cancel: 'Cancel',
    nameRequired: 'Give the skill a name.',
    body: (name: string) =>
      `# ${name}\n\n## When to use\n\n- \n\n## Steps\n\n1. \n\n## Assets\n\nPut the logo, stamp and intro music you need in assets/, and write here when each file is used.\n`,
  },
  brand: {
    sectionHint: 'BRAND.md in a project’s root folder. Every session in that project uses it automatically.',
    add: 'Add BRAND.md to a project',
    row: (project: string) => project,
    empty: 'No project has a BRAND.md yet.',
    detailTitle: (project: string) => `${project} · BRAND.md`,
    notFoundTitle: 'This project has no BRAND.md',
    notFoundBody: 'Add one to keep this project’s videos on brand.',
    projectGone: 'This project is gone; it may have been archived or removed.',
    alwaysOn:
      'Every message in this project’s sessions uses it automatically. What you say in the message comes first, then BRAND.md, then any brand skill that’s on. To skip it for one message, click × on “Brand: BRAND.md” above the input box.',
    noVersions: 'The file lives in the project folder: changes are saved straight to it, without versions.',
    newSession: 'New session in this project',
    remove: 'Delete',
    removeHint: 'Moves BRAND.md and brand/ to the Trash',
    removeTitle: (project: string) => `Delete BRAND.md from “${project}”?`,
    removeLabel: 'Delete BRAND.md',
    removeBody: (path: string) => `BRAND.md and the brand/ folder in ${path} move to the Trash. New messages in this project stop using them.`,
    removed: (project: string) => `Moved “${project}”’s BRAND.md to the Trash`,
    assetsHint: 'Files in brand/. The Agent gets their paths with every message and can put them straight into videos.',
    project: 'Project',
    pickProject: 'Choose a project',
    auto: 'Used automatically',
    precedenceTitle: 'When it conflicts with other instructions',
    precedence: [
      { title: 'What you say in the message', body: 'For example “no intro this time”' },
      { title: 'This project’s BRAND.md', body: 'Every session in this project uses it automatically, with no switch.' },
      { title: 'Brand skills that are on', body: 'Shared across projects; where they differ from BRAND.md, BRAND.md wins.' },
    ],
    createIntro: (path: string) =>
      `This project has no BRAND.md yet. Put one in the project’s root folder (${path}) and the Agent follows it in this project: show name, slogan, colors, fonts, logo, opening line and voice.`,
    templateHint: 'The template has sections for name and tone, look and sound; fill in yours. Put the logo, intro music and other assets in the brand/ folder.',
    fileBar: (path: string) => `${path} · stored in the project, takes effect as soon as you save`,
    fileNote: 'It’s an ordinary file in the project and travels with it when you copy, sync or hand over the project. If the project uses git, its history is there.',
    edit: 'Edit',
    addFiles: 'Add to brand/',
    saved: 'Saved: the next messages in this project follow the new brand rules',
    viewFiles: (n: number) => `View ${n} ${n === 1 ? 'file' : 'files'}`,
    more: 'More actions',
    noProjects: 'Every project already has a BRAND.md.',
    from: 'Start from',
    fromTemplate: 'Blank template',
    fromSkill: 'A brand skill',
    skill: 'Skill',
    skillPlaceholder: 'Choose a skill',
    fromSkillHint: 'SKILL.md minus its front matter becomes BRAND.md; files in assets/ and references/ move to brand/ and the paths follow. Scripts are left out.',
    create: 'Create',
    cancel: 'Cancel',
    created: (project: string) => `Added BRAND.md to “${project}”`,
    template: (project: string) =>
      `---\ndescription: Brand rules for ${project} videos\n---\n\n# ${project} brand\n\n## Name and tone\n\n- Show name: \n- Tone: \n\n## Look\n\n- Main color: \n- Fonts: \n- Logo: brand/logo.svg (bottom-right corner, 6% of the width)\n\n## Sound\n\n- Voice: \n- Intro and outro music: \n\n## Opening and ending\n\n- \n`,
    readOnlyWeb: 'In the browser BRAND.md is view-only.',
  },
  composer: {
    token: 'Brand: BRAND.md',
    tokenSkipped: 'Brand: not using BRAND.md for this message',
    open: 'Open this BRAND.md',
    skip: 'Don’t use BRAND.md for this message',
    restore: 'Use BRAND.md again',
    chipApplied: 'Used BRAND.md',
    chipSkipped: 'Didn’t use BRAND.md',
  },
  projectMenu: {
    brand: 'Brand (BRAND.md)',
    brandHintNew: 'Add one for this project',
  },
};
export type SkillsPageMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export const LIST_COPY = live(() => M.list);
export const BADGE_COPY = live(() => M.badge);
export const ADD_COPY = live(() => M.add);
export const MENU_COPY = live(() => M.menu);
export const TOAST_COPY = live(() => M.toast);
export const REMOVE_COPY = live(() => M.removeDialog);
export const DETAIL_COPY = live(() => M.detail);
export const FILES_COPY = live(() => M.files);
export const UPLOAD_COPY = live(() => M.upload);
export const BLANK_COPY = live(() => M.blank);
export const BRAND_COPY = live(() => M.brand);
export const BRAND_TOKEN_COPY = live(() => M.composer);
export const PROJECT_MENU_COPY = live(() => M.projectMenu);
