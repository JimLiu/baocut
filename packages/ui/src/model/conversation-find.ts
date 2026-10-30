import type { ConversationSearchHit, Id } from '@baocut/protocol';

/**
 * 在会话中查找（产品设计 §3.2.2「在会话中查找」）：服务端 `conversations.search` 给出整条记录里每条消息命中几处，
 * 这里只算「第几处落在哪条消息的第几处」、计数怎么写、重查后停在哪、要不要往前翻页。不碰 DOM。
 * 处数从 0 数，按记录顺序（最早的在前）。
 */

/** 查找停在的那一处：哪条消息里的第几处（从 0 数）。 */
export interface FindPlace {
  itemId: Id;
  nth: number;
}

/** 命中一共几处。 */
export function findTotal(hits: readonly ConversationSearchHit[]): number {
  let total = 0;
  for (const hit of hits) total += hit.count;
  return total;
}

/** 第 `at` 处落在哪条消息里的第几处；越界为 null。 */
export function locateFind(hits: readonly ConversationSearchHit[], at: number): { hit: ConversationSearchHit; nth: number } | null {
  if (at < 0) return null;
  let rest = at;
  for (const hit of hits) {
    if (rest < hit.count) return { hit, nth: rest };
    rest -= hit.count;
  }
  return null;
}

/** 计数「3 / 12」；结果到了上限被截断时总数后面加「+」（只是数不全，最近的那些照样能跳）。 */
export function findCountLabel(at: number, total: number, truncated: boolean): string {
  return `${at + 1} / ${total}${truncated ? '+' : ''}`;
}

/**
 * 重查之后停在哪一处：消息变了（新回复进来、流式长了）时，原来那一处还在就停在原处；不在了（或第一次查）停在最近的一处，
 * 即最后一处。没有命中为 -1。
 */
export function keepPlace(place: FindPlace | null, hits: readonly ConversationSearchHit[]): number {
  const total = findTotal(hits);
  if (!total) return -1;
  if (place) {
    let before = 0;
    for (const hit of hits) {
      if (hit.itemId === place.itemId) return place.nth < hit.count ? before + place.nth : before + hit.count - 1;
      before += hit.count;
    }
  }
  return total - 1;
}

/** 这条消息在已载入那一段之前（`offset` 是镜像里第一条在记录里的序号）：要先往前翻到它。 */
export function needsEarlier(hit: ConversationSearchHit, offset: number): boolean {
  return hit.index < offset;
}
