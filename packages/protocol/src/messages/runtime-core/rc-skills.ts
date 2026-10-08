import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-skills.zh-Hans.ts';
import { zhHant } from './rc-skills.zh-Hant.ts';
import { ja } from './rc-skills.ja.ts';
import { ko } from './rc-skills.ko.ts';
import { es } from './rc-skills.es.ts';
import { fr } from './rc-skills.fr.ts';
import { de } from './rc-skills.de.ts';
import { nl } from './rc-skills.nl.ts';
import { ptBR } from './rc-skills.pt-BR.ts';
import { it } from './rc-skills.it.ts';
import { ru } from './rc-skills.ru.ts';
import { pl } from './rc-skills.pl.ts';
import { tr } from './rc-skills.tr.ts';
import { vi } from './rc-skills.vi.ts';

/** 技能（skills/）的错误。英文是键与类型的来源，译文在 `rc-skills.<语言>.ts`。 */
const en = {
  cliOnlyPageLink: (p: { page: string }) => `Linked page ${p.page} is unavailable on the tool interface: it only has a CLI surface, so links to it must be in the CLI surface`,

  guideIdConflict: (p: { id: string }) => `ID "${p.id}" belongs to a BaoCut guide page, so this copy was not loaded. Rename the folder`,

  // 目录与校验（skill-catalog / skill-frontmatter）
  builtinConflict: (p: { id: string }) => `A built-in skill with the id "${p.id}" already exists, so this copy wasn't loaded. Rename the folder and add it again`,
  skillNotFound: (p: { id: string }) => `Skill not found: ${p.id}`,
  fileNotInSkill: (p: { id: string; file: string }) => `Skill "${p.id}" has no file ${p.file}`,
  fileTooLargeToShow: (p: { file: string; limit: number }) => `${p.file} is larger than ${p.limit} bytes and isn't shown here`,
  fileNotText: (p: { file: string }) => `${p.file} isn't a text file`,
  skillDirIsSymlink: "The skill folder is a symbolic link and isn't followed. Add the folder itself",
  duplicateId: (p: { id: string }) => `More than one folder in the same directory has the id "${p.id}"; none of them were loaded`,
  skillInvalid: "The skill isn't valid and wasn't loaded",
  noIdFromFolder: (p: { name: string }) => `The folder name "${p.name}" has no letters or digits, so no id can be derived`,
  missingRootFile: (p: { file: string }) => `${p.file} is missing from the root folder`,
  cannotReadFile: (p: { file: string }) => `Can't read ${p.file}`,
  fileOverBytes: (p: { file: string; limit: number }) => `${p.file} is larger than ${p.limit} bytes`,
  fileNotUtf8: (p: { file: string }) => `${p.file} isn't valid UTF-8`,
  fileProblem: (p: { file: string; problem: string }) => `${p.file}: ${p.problem}`,
  frontmatterMissingField: (p: { file: string; field: string }) => `The front matter of ${p.file} is missing ${p.field}`,
  fieldTooLong: (p: { field: string; limit: number }) => `${p.field} is longer than ${p.limit} characters`,
  pathTooLong: (p: { path: string }) => `Path too long: ${p.path}…`,
  noSymlinks: (p: { path: string }) => `Symbolic links aren't allowed: ${p.path}`,
  tooManyFiles: (p: { limit: number }) => `More than ${p.limit} files`,
  notRegularFile: (p: { path: string }) => `Not a regular file: ${p.path}`,
  cannotReadSkillDir: (p: { code: string }) => `Can't read the skill folder (${p.code})`,
  frontmatterMissingStart: 'The file must start with front matter (the first line is ---)',
  frontmatterUnclosed: 'The front matter has no closing ---',
  frontmatterBadLine: (p: { line: number; text: string }) => `Can't read line ${p.line} of the front matter: ${p.text}`,

  // GitHub 导入（skill-github）
  urlEmpty: 'Enter a repository address, such as owner/repo',
  urlNotGithub: 'Only GitHub repository addresses are supported',
  urlNeedsOwnerRepo: 'Write the address as owner/repo or https://github.com/owner/repo',
  urlBadChars: "The repository address has characters that aren't recognized",
  urlUnsupportedForm: 'Only a repository home page or a /tree/<branch>/<folder> address is supported',
  urlBadEncoding: "The address has encoding that isn't recognized",
  urlBadPath: "The path in the address isn't valid",
  whatRepo: (p: { where: string }) => `repository ${p.where}`,
  whatRef: (p: { where: string; ref: string }) => `${p.ref} of ${p.where}`,
  whatTree: (p: { where: string }) => `the folder listing of ${p.where}`,
  noDefaultBranch: (p: { where: string }) => `Couldn't read the default branch of ${p.where}`,
  noRefCommit: (p: { where: string; ref: string }) => `Couldn't read the commit that ${p.ref} of ${p.where} points to`,
  folderNotInRef: (p: { where: string; ref: string; folder: string }) => `${p.ref} of ${p.where} has no folder ${p.folder}`,
  treeTruncated: (p: { limit: number }) => `This folder has too many entries for GitHub to list in full: a skill has at most ${p.limit} files`,
  pathInvalid: (p: { path: string }) => `Invalid path: ${p.path}`,
  folderRootMissingFile: (p: { file: string }) => `There's no ${p.file} in the root of the folder`,
  notImportable: (p: { issue: string }) => `This folder isn't a skill that can be imported: ${p.issue}`,
  githubFolderTooLarge: (p: { files: number; bytes: number; maxFiles: number; maxBytes: number }) =>
    `This folder has ${p.files} files totaling ${p.bytes} bytes, over the skill limit (${p.maxFiles} files, ${p.maxBytes} bytes)`,
  githubNotJson: (p: { what: string }) => `GitHub didn't return JSON for ${p.what}`,
  githubConnectTimeout: (p: { what: string }) => `Timed out connecting to GitHub for ${p.what}`,
  githubUnreachable: (p: { what: string }) => `Couldn't connect to GitHub (fetching ${p.what})`,
  githubRedirectedAway: (p: { what: string }) => `Fetching ${p.what} was redirected to an address outside GitHub`,
  githubRateLimited: "GitHub's anonymous request limit is used up. Try importing again later",
  githubNotFound: (p: { what: string }) => `GitHub has no ${p.what} (or it's private)`,
  githubHttpStatus: (p: { what: string; status: number }) => `GitHub returned HTTP ${p.status} for ${p.what}`,
  githubDownloadTimeout: (p: { what: string }) => `Timed out downloading ${p.what} from GitHub`,
  githubConnectionLost: (p: { what: string }) => `The connection to GitHub dropped while downloading ${p.what}`,
  downloadTooLarge: (p: { what: string; limit: number }) =>
    `${p.what} exceeds the ${p.limit}-byte limit (the file is larger than GitHub listed, or the total exceeds the skill limit)`,

  // 添加、导入与移除（skill-installer）
  builtinNotRemovable: (p: { name: string }) => `"${p.name}" is a built-in skill and can't be removed. You can turn it off`,
  notInUserDir: (p: { dir: string }) => `The skill folder isn't under ${p.dir}, so it wasn't deleted`,
  sourceFolderNotFound: (p: { path: string }) => `Folder not found: ${p.path}`,
  folderOverlapsSkills: "This folder is inside BaoCut's skills folder (or contains it) and can't be added",
  foldersOverlap: (p: { source: string; skills: string }) => `${p.source} overlaps ${p.skills}`,
  notAddable: (p: { issue: string }) => `This folder isn't a skill that can be added: ${p.issue}`,
  folderNoSkillFile: (p: { file: string }) => `This folder has no ${p.file}: a skill folder needs a ${p.file} in its root`,
  folderBytesTooLarge: (p: { bytes: number; limit: number }) => `This folder totals ${p.bytes} bytes, over the skill limit (${p.limit} bytes)`,
  offlineStrictNoImport: "Skills aren't imported from GitHub in strict offline mode",
  noIdFromName: (p: { name: string }) => `"${p.name}" has no letters or digits, so no skill id can be derived. Give an id`,
  noSkillId: "Couldn't derive a skill id",
  skillExists: (p: { id: string; path: string }) => `A skill with the id "${p.id}" already exists (${p.path}). Remove it first or give another id`,
  writtenNotLoaded: (p: { path: string }) => `The skill was written to ${p.path} but couldn't be loaded. See diagnostics in skills.list`,

  // BaoCut skill（说明书，agent-skill-renderer）的标记法错误与 catalog.agentSkill
  /** 渲染错误带上文件与行号；`message` 是下面的某一条。 */
  renderErrorAt: (p: { file: string; line: number; message: string }) => `${p.file}:${p.line}: ${p.message}`,
  renderErrorIn: (p: { file: string; message: string }) => `${p.file}: ${p.message}`,
  agentSkillNoSymlinks: "The BaoCut skill folder can't contain symbolic links",
  agentSkillNoEntry: (p: { file: string }) => `The BaoCut skill folder has no ${p.file}`,
  surfaceNested: (p: { line: number }) => `surface markers can't be nested: the surface on line ${p.line} isn't closed yet`,
  unknownSurface: (p: { face: string }) => `Unknown surface "${p.face}": only cli and agent`,
  extraSurfaceClose: 'Extra <!-- /surface -->: there is no surface marker before it',
  generatedCrossesSurfaceClose: (p: { line: number }) => `The generated block on line ${p.line} must close before the surface closes`,
  generatedNested: (p: { line: number }) => `Generated blocks can't be nested: the generated block on line ${p.line} isn't closed yet`,
  unknownGenerated: (p: { name: string; names: string }) => `Unknown generated block "${p.name}": only ${p.names}`,
  extraGeneratedClose: 'Extra <!-- /generated -->: there is no generated block before it',
  generatedCrossesSurface: (p: { line: number }) => `The generated block on line ${p.line} crosses a surface marker`,
  surfaceUnclosed: "surface marker isn't closed",
  generatedUnclosed: "Generated block isn't closed",
  badToolName: (p: { placeholder: string }) => `Invalid tool name: ${p.placeholder}`,
  toolNotInCatalog: (p: { placeholder: string; face: string }) =>
    `${p.placeholder}: the ${p.face === 'cli' ? 'CLI' : 'tool bridge'} catalog has no such tool`,
  badArgName: (p: { placeholder: string }) => `Write parameter names as the catalog's field names (camelCase): ${p.placeholder}`,
  badCraftId: (p: { placeholder: string }) => `Invalid craft id: ${p.placeholder}`,
  craftNotFound: (p: { placeholder: string; dir: string }) => `${p.placeholder}: there's no such craft in ${p.dir}/`,
  unknownPlaceholder: (p: { placeholder: string }) => `Unknown placeholder ${p.placeholder}: only {{tool:…}}, {{arg:…}}, and {{skill:…}}`,
  placeholderUnclosed: 'Unclosed placeholder (a {{ has no matching }})',
  linkTargetMissing: (p: { link: string; target: string }) => `Link ${p.link} points to ${p.target}, which isn't in the BaoCut skill`,
  agentSkillRenderFailed: (p: { problem: string }) => `Couldn't render the BaoCut skill: ${p.problem}`,
  agentSkillDirNotFound: (p: { dir: string }) => `Can't find the BaoCut skill folder (${p.dir})`,
};

export type RcSkillsMessages = typeof en;

export const RcSkills = defineCatalog('rcSkills', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
