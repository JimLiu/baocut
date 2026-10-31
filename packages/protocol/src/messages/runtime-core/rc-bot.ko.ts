// PLACEHOLDER: copied from English, to be translated.
import type { RcBotMessages } from './rc-bot.ts';

export const ko: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Main',
  channelNotFound: (p: { id: string }) => `Channel not found: ${p.id}`,
  mainChannelLocked: "The main channel can't be archived or deleted.",
  channelArchived: 'This channel is archived. Restore it before working in it.',
  channelDeleteCountsChanged: 'The number of tasks or scheduled tasks in this channel changed. Check again before deleting.',
  memoryVersionConflict: 'The memory changed since you opened it. Review the latest version and try again.',
  memoryTooLarge: (p: { max: number }) => `Memory can be at most ${p.max} KB. Tidy it up before adding more.`,
  memorySensitive: "Don't put keys, passwords, ID numbers or card numbers in memory.",
  accessAboveChannelMax: "The task's access mode can't be higher than the channel's limit.",

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `Task not found: ${p.id}`,
  transitionDenied: (p: { from: string; event: string }) => `This task can't do "${p.event}" while it is ${p.from}.`,
  textHasLinkOrNumber: 'Task text should not contain links, email addresses or long numbers. Put them in resources instead.',
  titleByUser: "You wrote this title, so the agent can't change it.",
  userTasksNoThread: "Your own tasks don't start a thread.",
  stoppedByYou: 'You stopped this.',
  continueOrStop: 'Keep going or stop?',
  optionContinue: 'Continue',
  optionStop: 'Stop',
  stalledNoProgress: (p: { minutes: number }) => `No progress for ${p.minutes} minutes.`,
  stalledJobHung: (p: { job: string }) => `${p.job} has gone quiet for much longer than expected.`,
  stalledBudget: 'This task has used 80% of its budget.',
  interruptedOnExit: 'Interrupted when BaoCut last quit.',
  threadLost: "This task's thread is missing.",
  needsYouToRun: (p: { agent: string }) => `This step needs you here: ${p.agent} can't ask for approval step by step. Continue now?`,
  approvalWaiting: (p: { summary: string }) => `Waiting for your approval: ${p.summary}`,
  youAnswered: (p: { text: string }) => `You answered: ${p.text}`,
  youConfirmedDone: 'You confirmed it is done.',
  youReopened: 'You reopened this task.',
  previousQuestion: (p: { text: string }) => `Earlier question: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `The thread changed ${p.what} after the task was resolved.`,
  movedFrom: (p: { channel: string }) => `Moved from ${p.channel}.`,
  queued: (p: { position: number }) => `Waiting for a free slot (#${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) => `You edited ${p.video} in version ${p.version}, so only undoing the agent's changes isn't possible.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `Version ${p.version} of ${p.video} mixes your edits with the agent's, so only undoing the agent's changes isn't possible.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `Reminder: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `${p.title} was due on ${p.date}. It's still open.`,
  reminderStale: (p: { title: string; days: number }) => `${p.title} has been waiting on you for ${p.days} days.`,
  welcome:
    "Hi, I'm your assistant here. Tell me what you want done with your videos and I'll take care of it, and I'll check in when something needs you.",
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Hi, I'm your assistant here. I can see ${p.projects} projects with ${p.videos} videos. Tell me what you want done and I'll take care of it.`,
  starterSummarize: 'Summarize a video',
  starterSummarizeText: 'Summarize my latest video for me',
  starterCaptions: 'Add captions',
  starterCaptionsText: 'Add captions to my latest video',
  starterHighlights: 'Find highlights',
  starterHighlightsText: 'Find the best moments in my latest video',
  markDone: 'Mark done',
  handoffDriver: (p: { agent: string }) => `Continuing with ${p.agent}.`,
  editedMessage: 'You edited this message.',

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `${p.title} is ready for you to review`,
  notifyNeedsInput: (p: { title: string }) => `${p.title} needs your answer`,
  notifyStalled: (p: { title: string }) => `${p.title} is stuck`,
  notifyReminder: (p: { title: string }) => `Reminder: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'This card is no longer available.',
  proposalHandled: 'This card was already handled.',
  chipStale: 'These suggestions are out of date.',
  automationPaused: 'Automation is paused.',
};
