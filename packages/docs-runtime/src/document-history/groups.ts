/** history-groups: restored from historyGroups-CUQo9J_g.js. */
import type { Dynamic } from "../interop/legacy-dynamic";
import {
  resolveCommentsActionsAndSelectionName,
  resolveEditorAnchorsAndMentionsEmail,
  resolveEditorAnchorsAndMentionsOther,
  resolvePlatformLiveDocumentAndHistoryParams,
  resolvePlatformSessionAndSourcesRound,
  resolvePlatformSessionAndSourcesValue,
  resolvePlatformSessionAndSourcesValue3,
  resolvePlatformSyncAndRoutingIsFinite3,
} from "../platform/index";
var SYSTEM_ACTORS: Dynamic = new (Set as Dynamic)([
  `ldoc-peer`,
  `iron-peer`,
  `lfile-room`,
  `system`,
  `room`,
]);
function contributorOf(
  actor?: Dynamic,
  user?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  // BaoCut: 版本面板里智能体署名「Agent」（同批注与光标旗子，见 README「文案」），kind 仍是 claude。
  if (actor.startsWith(`agent:`))
    return {
      kind: `claude`,
      label: `Agent`,
    };
  let principal: Dynamic =
    actor.startsWith(`restore:`) || actor.startsWith(`revert:`)
      ? (actor.split(`:`)[1] ?? user)
      : user;
  if (SYSTEM_ACTORS.has(principal))
    return {
      kind: `system`,
      label: `auto-save`,
    };
  let principalKind: string = resolveEditorAnchorsAndMentionsOther(principal);
  return {
    kind: `human`,
    label:
      principalKind === `platform` ||
      principalKind === `account` ||
      principalKind === `pseudonym`
        ? resolveEditorAnchorsAndMentionsEmail(
            principal,
            principalKind === `account`
              ? (resolveCommentsActionsAndSelectionName(principal) ?? undefined)
              : undefined,
          )
        : resolvePlatformSessionAndSourcesValue(principal) || principal,
    email: principal,
  };
}
function restoredFromRevision(
  activity?: Dynamic,
  ..._extraArguments: unknown[]
): number | undefined {
  let revision: Dynamic = activity.params.restoredFrom;
  return typeof revision == `number` ? revision : undefined;
}
function restoreLabel(activity?: Dynamic, ..._extraArguments: unknown[]) {
  let restoredFrom: Dynamic = restoredFromRevision(activity);
  return restoredFrom === undefined
    ? resolvePlatformLiveDocumentAndHistoryParams(activity) === `restore`
      ? `Restore point`
      : activity.actor.startsWith(`restore:`) ||
          activity.actor.startsWith(`revert:`)
        ? `restored`
        : null
    : `Restored · from rev ${restoredFrom}`;
}
var contributorKey: Dynamic = (
  contributor?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic =>
  contributor.kind === `human`
    ? `human:${contributor.email.toLowerCase()}`
    : contributor.kind;
function contributorsOf(
  activity?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let rawContributors: Dynamic = activity.params.contributors;
  let validContributors: Dynamic =
    Array.isArray(rawContributors) && rawContributors.length > 0
      ? rawContributors.flatMap(
          (rawContributor?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
            rawContributor &&
            typeof rawContributor == `object` &&
            typeof rawContributor.user == `string` &&
            typeof rawContributor.actor == `string`
              ? [rawContributor]
              : [],
        )
      : [];
  let contributors: Dynamic =
    validContributors.length > 0
      ? validContributors
      : [
          {
            user: activity.user,
            actor: activity.actor,
          },
        ];
  let unique: Dynamic = new (Map as Dynamic)();
  for (let contributorsOfResult of contributors as Dynamic) {
    let contributorOf2: Dynamic = contributorOf(
      contributorsOfResult.actor,
      contributorsOfResult.user,
    );
    let contributorKey2: Dynamic = contributorKey(contributorOf2);
    if (!unique.has(contributorKey2)) {
      unique.set(contributorKey2, contributorOf2);
    }
  }
  if (unique.size > 1) {
    unique.delete(`system`);
  }
  return [...unique.values()];
}
function mergeContributors(
  contributorGroups?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let unique: Dynamic = new (Map as Dynamic)();
  for (let mergeContributorsResult of contributorGroups as Dynamic)
    for (let mergeContributorsResult2 of mergeContributorsResult as Dynamic)
      if (!unique.has(contributorKey(mergeContributorsResult2))) {
        unique.set(
          contributorKey(mergeContributorsResult2),
          mergeContributorsResult2,
        );
      }
  if (unique.size > 1) {
    unique.delete(`system`);
  }
  return [...unique.values()];
}
function contributorsSummary(
  contributors?: Dynamic,
  maxPeople: Dynamic = 2,
  ..._extraArguments: unknown[]
): Dynamic {
  let humans: Dynamic = contributors.filter(
    (entry?: Dynamic, ..._extraArguments: unknown[]) => entry.kind === `human`,
  );
  let hasClaude: Dynamic = contributors.some(
    (entry?: Dynamic, ..._extraArguments: unknown[]) => entry.kind === `claude`,
  );
  let labels: Dynamic = humans
    .slice(0, maxPeople)
    .map(
      (humansSlice?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        humansSlice.label,
    );
  if (humans.length > maxPeople) {
    labels.push(`${humans.length - maxPeople} more`);
  }
  let people: Dynamic = labels.join(`, `);
  return hasClaude
    ? people
      ? `${people} + Agent`
      : `Agent`
    : people || (contributors[0]?.label ?? ``);
}
function changeCountLabel(
  total?: Dynamic,
  locale?: Dynamic,
  options: Dynamic = {},
  ..._extraArguments: unknown[]
) {
  let number: number = Number(total);
  let count: number = Number.isFinite(number)
    ? Math.max(0, Math.round(number))
    : 0;
  return count === 0
    ? options.net === true
      ? `No net changes`
      : `No changes`
    : count === 1
      ? `1 change`
      : `${count.toLocaleString(locale)} changes`;
}
function changeStatsLabel(
  stats?: Dynamic,
  locale?: Dynamic,
  options: Dynamic = {},
  ..._extraArguments: unknown[]
): string {
  let unchecked: string = resolvePlatformSyncAndRoutingIsFinite3(
    stats.unchecked,
  );
  let count: string = changeCountLabel(stats.total, locale, options);
  return unchecked === `` ? count : `${count} · ${unchecked}`;
}
function contributorsAccessibleLabel(
  contributors?: Dynamic,
  maxPeople: Dynamic = 2,
  ..._extraArguments: unknown[]
): Dynamic {
  let humans: Dynamic = contributors
    .filter(
      (entry?: Dynamic, ..._extraArguments: unknown[]) =>
        entry.kind === `human`,
    )
    .map(
      (filteredItem?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
        filteredItem.label,
    );
  let labels: Dynamic = humans.slice(0, maxPeople);
  if (humans.length > maxPeople) {
    labels.push(`${humans.length - maxPeople} more`);
  }
  if (
    contributors.some(
      (entry?: Dynamic, ..._extraArguments: unknown[]) =>
        entry.kind === `claude`,
    )
  ) {
    labels.push(`Agent`);
  }
  return labels.length === 0
    ? (contributors[0]?.label ?? ``)
    : labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(`, `)} and ${labels[labels.length - 1]}`;
}
var sameContributors: Dynamic = (
  before?: Dynamic,
  after?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => {
  if (before.length !== after.length) return false;
  let keys: Dynamic = new (Set as Dynamic)(before.map(contributorKey));
  return after.every(
    (after2?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
      keys.has(contributorKey(after2)),
  );
};
function groupHistoryByActor(
  activities?: Dynamic,
  options: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let gapMs: Dynamic = options.gapMs ?? 3e5;
  let spanMs: Dynamic = options.spanMs ?? 18e5;
  let isSingleton: Dynamic =
    options.isSingleton ?? ((..._extraArguments: unknown[]) => false);
  let groups: Dynamic = [];
  for (let activity of activities as Dynamic) {
    let contributorsOf2: Dynamic = contributorsOf(activity);
    let groupItem: Dynamic = groups[groups.length - 1];
    let parse: number = Date.parse(activity.at);
    if (
      groupItem !== undefined &&
      !isSingleton(activity) &&
      !isSingleton(groupItem.items[0])
    ) {
      let parse2: number = Date.parse(
        groupItem.items[groupItem.items.length - 1].at,
      );
      let parse3: number = Date.parse(groupItem.items[0].at);
      if (
        Number.isFinite(parse) &&
        Number.isFinite(parse2) &&
        parse2 - parse <= gapMs &&
        parse3 - parse <= spanMs &&
        sameContributors(contributorsOf2, groupItem.contributors)
      ) {
        groupItem.items.push(activity);
        continue;
      }
    }
    groups.push({
      key: activity.id,
      items: [activity],
      contributors: contributorsOf2,
    });
  }
  for (let event of groups as Dynamic)
    event.key = event.items[event.items.length - 1].id;
  return groups;
}
function checkpointMetadata(
  activity?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let rawCheckpoint: Dynamic = activity.params.checkpoint;
  if (typeof rawCheckpoint != `object` || !rawCheckpoint) return null;
  let checkpoint: Dynamic = rawCheckpoint;
  return {
    ...(typeof checkpoint.boundary == `string`
      ? {
          boundary: checkpoint.boundary,
        }
      : {}),
    ...(checkpoint.stored === true
      ? {
          stored: true,
        }
      : {}),
    ...(typeof checkpoint.name == `string`
      ? {
          name: checkpoint.name,
        }
      : {}),
  };
}
// BaoCut: 右栏的版本列表据此不合并服务端分好的版本（comments/right-rail.tsx）。
function isCheckpointBoundary(
  activity?: Dynamic,
  ..._extraArguments: unknown[]
): boolean {
  let checkpoint: Dynamic = checkpointMetadata(activity);
  return checkpoint === null
    ? false
    : checkpoint.stored === true ||
        (checkpoint.boundary !== undefined && checkpoint.boundary !== `open`);
}
function checkpointName(
  activity?: Dynamic,
  ..._extraArguments: unknown[]
): null | string {
  let name: Dynamic = activity.params.name;
  return typeof name == `string` && name.trim() !== `` ? name.trim() : null;
}
var checkpointSequence: Dynamic = (
  activity?: Dynamic,
  ..._extraArguments: unknown[]
): number => {
  let upto: Dynamic = activity.params.upto;
  return typeof upto == `number` ? upto : NaN;
};
function groupCheckpointHistory(
  activities?: Dynamic,
  options: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let gapMs: Dynamic = options.gapMs ?? 3e5;
  let spanMs: Dynamic = options.spanMs ?? 18e5;
  let handoffMs: Dynamic = options.handoffMs ?? 18e4;
  let claudeMs: Dynamic = options.claudeMs ?? 9e4;
  let interleaveMs: Dynamic = options.interleaveMs ?? 12e4;
  let isEvent: Dynamic =
    options.isEvent ?? ((..._extraArguments: unknown[]) => false);
  let isNamed: Dynamic =
    options.isNamed ??
    ((groupCheckpointHistory2?: Dynamic, ..._extraArguments: unknown[]) =>
      checkpointName(groupCheckpointHistory2) !== null);
  let dayOf: Dynamic = options.dayOf ?? ((..._extraArguments: unknown[]) => ``);
  let isEdge: Dynamic = options.isEdge ?? isCheckpointBoundary;
  let seenIds: Dynamic = new (Set as Dynamic)();
  let entries: Dynamic = [];
  for (let activity of activities as Dynamic) {
    if (seenIds.has(activity.id)) continue;
    seenIds.add(activity.id);
    let contributorsOf2: Dynamic = contributorsOf(activity);
    let parse: number = Date.parse(activity.at);
    entries.push({
      a: activity,
      t: parse,
      cs: contributorsOf2,
      people: contributorsOf2
        .filter(
          (entry?: Dynamic, ..._extraArguments: unknown[]) =>
            entry.kind === `human`,
        )
        .map(contributorKey),
      claude: contributorsOf2.some(
        (entry?: Dynamic, ..._extraArguments: unknown[]) =>
          entry.kind === `claude`,
      ),
      event: isEvent(activity) || !Number.isFinite(parse),
      named: isNamed(activity),
      edge: isEdge(activity),
      day: dayOf(activity),
    });
  }
  let timestamp: Dynamic = (
    groupCheckpointHistory2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    Number.isFinite(groupCheckpointHistory2.t)
      ? groupCheckpointHistory2.t
      : -1 / 0;
  entries.sort(
    (
      entry?: Dynamic,
      entry2?: Dynamic,
      ..._extraArguments: unknown[]
    ): number => {
      let difference: number = timestamp(entry) - timestamp(entry2);
      if (difference !== 0 && !Number.isNaN(difference)) return difference;
      let checkpointSequence2: Dynamic = checkpointSequence(entry.a);
      let checkpointSequence3: Dynamic = checkpointSequence(entry2.a);
      return Number.isFinite(checkpointSequence2) &&
        Number.isFinite(checkpointSequence3) &&
        checkpointSequence2 !== checkpointSequence3
        ? checkpointSequence2 - checkpointSequence3
        : entry.a.id < entry2.a.id
          ? -1
          : +(entry.a.id > entry2.a.id);
    },
  );
  let samePeopleWithinGap: Dynamic = (
    groupCheckpointHistory2?: Dynamic,
    options2?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic =>
    options2.people.length > 0 &&
    groupCheckpointHistory2.lastSeen.size > 0 &&
    options2.people.every(
      (people?: Dynamic, ..._extraArguments: unknown[]) =>
        !groupCheckpointHistory2.lastSeen.has(people),
    ) &&
    [...groupCheckpointHistory2.lastSeen.values()].every(
      (item?: Dynamic, ..._extraArguments: unknown[]) =>
        options2.t - item >= handoffMs,
    );
  let mayAppend: Dynamic = (
    groupCheckpointHistory2?: Dynamic,
    options2?: Dynamic,
    ..._extraArguments: unknown[]
  ): boolean => {
    let memberItem: Dynamic =
      groupCheckpointHistory2.members[
        groupCheckpointHistory2.members.length - 1
      ];
    let memberItem2: Dynamic = groupCheckpointHistory2.members[0];
    return options2.event ||
      memberItem.event ||
      memberItem.named ||
      options2.edge ||
      memberItem.edge ||
      options2.day !== memberItem.day ||
      options2.t - memberItem.t > gapMs ||
      options2.t - memberItem2.t > spanMs
      ? false
      : options2.claude === memberItem.claude
        ? options2.claude
          ? options2.t - memberItem.t <= claudeMs
          : !samePeopleWithinGap(groupCheckpointHistory2, options2)
        : options2.t - memberItem.t >= interleaveMs
          ? false
          : options2.claude
            ? groupCheckpointHistory2.lastPersonT === null ||
              options2.t - groupCheckpointHistory2.lastPersonT < interleaveMs
            : groupCheckpointHistory2.claudeSince === null ||
              options2.t - groupCheckpointHistory2.claudeSince < interleaveMs;
  };
  let groups: Dynamic = [];
  for (let groupCheckpointHistoryResult of entries as Dynamic) {
    let groupItem: Dynamic = groups[groups.length - 1];
    if (
      groupItem !== undefined &&
      mayAppend(groupItem, groupCheckpointHistoryResult)
    ) {
      groupItem.members.push(groupCheckpointHistoryResult);
    } else {
      groups.push({
        members: [groupCheckpointHistoryResult],
        lastSeen: new (Map as Dynamic)(),
        lastPersonT: null,
        claudeSince: null,
      });
    }
    let groupItem2: Dynamic = groups[groups.length - 1];
    for (let groupCheckpointHistoryResult2 of groupCheckpointHistoryResult.people as Dynamic)
      groupItem2.lastSeen.set(
        groupCheckpointHistoryResult2,
        groupCheckpointHistoryResult.t,
      );
    if (groupCheckpointHistoryResult.people.length > 0) {
      groupItem2.lastPersonT = groupCheckpointHistoryResult.t;
      groupItem2.claudeSince = null;
    } else {
      if (groupCheckpointHistoryResult.claude) {
        groupItem2.claudeSince ??= groupCheckpointHistoryResult.t;
      }
    }
  }
  return groups.toReversed().map(
    (
      { members: members }: Dynamic,
      ..._extraArguments: unknown[]
    ): Dynamic => ({
      key: members[0].a.id,
      items: members
        .map((item?: Dynamic, ..._extraArguments: unknown[]): Dynamic => item.a)
        .toReversed(),
      contributors: mergeContributors(
        members
          .toReversed()
          .map(
            (toReversed?: Dynamic, ..._extraArguments: unknown[]): Dynamic =>
              toReversed.cs,
          ),
      ),
    }),
  );
}
var checkpointRole: Dynamic = resolvePlatformLiveDocumentAndHistoryParams;
function hasVersionEvents(
  activities?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  return activities.some(
    (item?: Dynamic, ..._extraArguments: unknown[]) =>
      checkpointRole(item) !== null,
  );
}
function currentVersionId(
  activities?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let newest: Dynamic = null;
  for (let activity of activities as Dynamic)
    if (
      newest === null ||
      activity.at > newest.at ||
      (activity.at === newest.at &&
        checkpointSequence(activity) > checkpointSequence(newest))
    ) {
      newest = activity;
    }
  return newest !== null && checkpointRole(newest) === `current`
    ? newest.id
    : null;
}
var contributorSetKey: Dynamic = (
  contributors?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic => contributors.map(contributorKey).toSorted().join(`|`);
function historyRows(
  activities?: Dynamic,
  options: Dynamic = {},
  ..._extraArguments: unknown[]
): Dynamic {
  let isEvent: Dynamic =
    options.isEvent ?? ((..._extraArguments: unknown[]) => false);
  let dayOf: Dynamic = options.dayOf ?? ((..._extraArguments: unknown[]) => ``);
  let seenIds: Dynamic = new (Set as Dynamic)();
  let unique: Dynamic = [];
  for (let historyRowsResult of activities as Dynamic)
    if (!seenIds.has(historyRowsResult.id)) {
      seenIds.add(historyRowsResult.id);
      unique.push(historyRowsResult);
    }
  unique.sort(
    (
      activity?: Dynamic,
      activity2?: Dynamic,
      ..._extraArguments: unknown[]
    ): number => {
      if (activity.at !== activity2.at)
        return activity.at < activity2.at ? 1 : -1;
      let checkpointSequence2: Dynamic = checkpointSequence(activity);
      let checkpointSequence3: Dynamic = checkpointSequence(activity2);
      return Number.isFinite(checkpointSequence2) &&
        Number.isFinite(checkpointSequence3) &&
        checkpointSequence2 !== checkpointSequence3
        ? checkpointSequence3 - checkpointSequence2
        : activity.id < activity2.id
          ? 1
          : activity.id > activity2.id
            ? -1
            : 0;
    },
  );
  let rows: Dynamic = [];
  for (let historyRowsResult of unique as Dynamic) {
    let contributorsOf2: Dynamic = contributorsOf(historyRowsResult);
    let contributorSetKey2: Dynamic = contributorSetKey(contributorsOf2);
    let dayOf2: Dynamic = dayOf(historyRowsResult);
    let isEvent2: Dynamic =
      isEvent(historyRowsResult) ||
      checkpointRole(historyRowsResult) === `current`;
    let rowItem: Dynamic = rows[rows.length - 1];
    if (
      rowItem !== undefined &&
      !isEvent2 &&
      !rowItem.event &&
      rowItem.day === dayOf2 &&
      rowItem.who === contributorSetKey2
    ) {
      rowItem.items.push(historyRowsResult);
      continue;
    }
    rows.push({
      key: historyRowsResult.id,
      items: [historyRowsResult],
      contributors: contributorsOf2,
      who: contributorSetKey2,
      day: dayOf2,
      event: isEvent2,
    });
  }
  return rows.map(
    (row?: Dynamic, ..._extraArguments: unknown[]): Dynamic => ({
      key: row.items[row.items.length - 1].id,
      items: row.items,
      contributors: mergeContributors(row.items.map(contributorsOf)),
    }),
  );
}
function historyDayLabel(
  at?: Dynamic,
  now?: Dynamic,
  locale?: Dynamic,
  timeZone?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let date: Dynamic = new (Date as Dynamic)(at);
  let daysAgo: Dynamic = resolvePlatformSessionAndSourcesRound(
    date,
    now,
    timeZone,
  );
  return daysAgo <= 0
    ? `Today`
    : daysAgo === 1
      ? `Yesterday`
      : daysAgo < 7
        ? date.toLocaleDateString(locale, {
            weekday: `long`,
            timeZone: timeZone,
          })
        : resolvePlatformSessionAndSourcesValue3(date, timeZone) ===
            resolvePlatformSessionAndSourcesValue3(now, timeZone)
          ? date.toLocaleDateString(locale, {
              month: `long`,
              day: `numeric`,
              timeZone: timeZone,
            })
          : date.toLocaleDateString(locale, {
              year: `numeric`,
              month: `short`,
              day: `numeric`,
              timeZone: timeZone,
            });
}
var dayFormatters: Dynamic = new (Map as Dynamic)();
function dayKey(
  date?: Dynamic,
  timeZone?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let zoneKey: Dynamic = timeZone ?? ``;
  let formatter: Dynamic = dayFormatters.get(zoneKey);
  if (formatter === undefined) {
    formatter = new (Intl.DateTimeFormat as Dynamic)(`en-CA`, {
      timeZone: timeZone,
      year: `numeric`,
      month: `2-digit`,
      day: `2-digit`,
    });
    dayFormatters.set(zoneKey, formatter);
  }
  return formatter.format(date);
}
function makeHistoryDayLabeler(
  now?: Dynamic,
  locale?: Dynamic,
  timeZone?: Dynamic,
  ..._extraArguments: unknown[]
): Dynamic {
  let labelsByDay: Dynamic = new (Map as Dynamic)();
  return (
    historyDayLabeler?: Dynamic,
    ..._extraArguments: unknown[]
  ): Dynamic => {
    let date: Dynamic = new (Date as Dynamic)(historyDayLabeler);
    if (Number.isNaN(date.getTime()))
      return historyDayLabel(historyDayLabeler, now, locale, timeZone);
    let dayKey2: Dynamic = dayKey(date, timeZone);
    let labelsByDayEntry: Dynamic = labelsByDay.get(dayKey2);
    if (labelsByDayEntry === undefined) {
      labelsByDayEntry = historyDayLabel(
        historyDayLabeler,
        now,
        locale,
        timeZone,
      );
      labelsByDay.set(dayKey2, labelsByDayEntry);
    }
    return labelsByDayEntry;
  };
}
export {
  makeHistoryDayLabeler,
  groupCheckpointHistory,
  restoreLabel,
  checkpointName,
  contributorsAccessibleLabel,
  currentVersionId,
  contributorsSummary,
  groupHistoryByActor,
  isCheckpointBoundary,
  contributorsOf,
  historyRows,
  changeStatsLabel,
  hasVersionEvents,
};
