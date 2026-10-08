import type { Id } from '@baocut/protocol';
import { readJson, writeJsonAtomic } from './json-file.ts';

/** Space 条目上的用户标记（架构设计 §5.7 的 `user.*`）。索引重建不丢它们。 */
export interface SpaceMark {
  favorite: boolean;
  displayName: string | null;
  trashedAt: string | null;
  /** 用户清除了这条失败的占位（`space.purge`）：它没有 bytes，清除只是不再显示。旧文件里没有这一项。 */
  dismissedAt?: string | null;
}

/**
 * 经 `space.import` 登记的项目文件（架构设计 §5.7「项目里不属于视频的文件」）。bytes 的权威是项目目录里的文件本身，
 * 这里只记它属于哪个项目、在项目里的相对路径与登记时间；文件被外部移走或删掉后条目显示为 `missing`。
 */
export interface SpaceImport {
  projectId: Id;
  /** 相对项目目录，用 `/` 分隔。 */
  relPath: string;
  importedAt: string;
  /** 从项目之外复制进来时，原文件的文件名（不记原路径）。 */
  copiedFrom: string | null;
}

/**
 * 删除了的视频（`videos.delete`，架构设计 §5.5、§5.7）：视频目录整个移进来源目录里的回收站 `.bcut-trash/<trashId>/<目录名>`。
 * 键是它在回收站里的条目 id（来源键与 `trashRelPath` 的摘要）：原来的位置之后可能放进另一个视频，两者不能共用一个 id。
 * 先写这条记录再移动目录，恢复时先移回再删记录：中途崩溃，启动时按目录实际在哪里对账。
 * 路径都相对来源目录，项目目录被移动之后照样找得到。
 */
export interface TrashedVideo {
  /** 删除之前的条目 id：撤销与恢复可以用它找到这条记录。 */
  formerEntryId: Id;
  /** 来源键：`project:<id>` 或 `conv:<id>`。 */
  sourceKey: string;
  projectId: Id | null;
  conversationId: Id | null;
  /** 原来的相对路径，用 `/` 分隔。 */
  relPath: string;
  /** 在回收站里的相对路径：`.bcut-trash/<trashId>/<目录名>`。 */
  trashRelPath: string;
  videoId: Id | null;
  name: string;
  size: number;
  trashedAt: string;
}

interface SpaceFile {
  schemaVersion: 1;
  marks: Record<Id, SpaceMark>;
  /** 后加的：旧文件没有。 */
  imports?: Record<Id, SpaceImport>;
  /** 后加的：旧文件没有。 */
  trashedVideos?: Record<Id, TrashedVideo>;
}

export const EMPTY_MARK: SpaceMark = { favorite: false, displayName: null, trashedAt: null };

/** 标记全空的条目不落盘，文件只记有意义的东西。 */
function isEmpty(mark: SpaceMark): boolean {
  return !mark.favorite && mark.displayName === null && mark.trashedAt === null && !mark.dismissedAt;
}

export class SpaceMarkStore {
  readonly #file: string;
  #marks = new Map<Id, SpaceMark>();
  #imports = new Map<Id, SpaceImport>();
  #trashedVideos = new Map<Id, TrashedVideo>();
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<void> {
    const data = await readJson<SpaceFile>(this.#file);
    this.#marks = new Map(Object.entries(data?.marks ?? {}));
    this.#imports = new Map(Object.entries(data?.imports ?? {}));
    this.#trashedVideos = new Map(Object.entries(data?.trashedVideos ?? {}));
  }

  get(id: Id): SpaceMark {
    return this.#marks.get(id) ?? EMPTY_MARK;
  }

  put(id: Id, mark: SpaceMark): Promise<void> {
    if (isEmpty(mark)) this.#marks.delete(id);
    else this.#marks.set(id, mark);
    return this.#save();
  }

  /** 物理删除之后：标记、登记与删除的视频的记录一起去掉。 */
  remove(id: Id): Promise<void> {
    this.#marks.delete(id);
    this.#imports.delete(id);
    this.#trashedVideos.delete(id);
    return this.#save();
  }

  trashedVideos(): ReadonlyMap<Id, TrashedVideo> {
    return this.#trashedVideos;
  }

  /** 记下删除的视频：用户标记从原来的条目搬过来，写上回收站标记（一次落盘）。 */
  putTrashedVideo(id: Id, record: TrashedVideo): Promise<void> {
    this.#trashedVideos.set(id, record);
    this.#marks.set(id, { ...this.get(record.formerEntryId), trashedAt: record.trashedAt });
    this.#marks.delete(record.formerEntryId);
    return this.#save();
  }

  /** 视频回到来源目录（恢复，或启动时发现移动没有发生）：去掉记录，用户标记去掉回收站标记后搬到 `to`。 */
  dropTrashedVideo(id: Id, to: Id): Promise<void> {
    this.#trashedVideos.delete(id);
    const mark = { ...this.get(id), trashedAt: null };
    this.#marks.delete(id);
    if (!isEmpty(mark)) this.#marks.set(to, mark);
    return this.#save();
  }

  imports(): ReadonlyMap<Id, SpaceImport> {
    return this.#imports;
  }

  putImport(id: Id, record: SpaceImport): Promise<void> {
    this.#imports.set(id, record);
    return this.#save();
  }

  flush(): Promise<void> {
    return this.#saving;
  }

  #save(): Promise<void> {
    const snapshot: SpaceFile = {
      schemaVersion: 1,
      marks: Object.fromEntries(this.#marks),
      ...(this.#imports.size > 0 ? { imports: Object.fromEntries(this.#imports) } : {}),
      ...(this.#trashedVideos.size > 0 ? { trashedVideos: Object.fromEntries(this.#trashedVideos) } : {}),
    };
    this.#saving = this.#saving.catch(() => {}).then(() => writeJsonAtomic(this.#file, snapshot));
    return this.#saving;
  }
}
