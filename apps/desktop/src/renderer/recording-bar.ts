import type { BarPayload } from '../main/recording/recording-service.ts';

/*
 * 录制控制条的页面（屏幕录制设计 §11「录制中」）：文字由主进程按当前语言给，这里只摆出来、回报按钮。
 * 丢弃要在条上再确认一次：按「丢弃」换成「丢弃这次录制？丢弃 / 继续录」，确认才发出去。
 */

interface BarBridge {
  onView(listener: (view: BarPayload) => void): () => void;
  act(action: 'pause' | 'resume' | 'stop' | 'discard'): Promise<void>;
}

const bridge = (window as unknown as { recordingBar: BarBridge }).recordingBar;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const bar = $('bar');
const title = $('title');
const time = $('time');
const notice = $('notice');
const main = $('main');
const confirm = $('confirm');
const confirmText = $('confirm-text');
const buttons = {
  pause: $<HTMLButtonElement>('pause'),
  resume: $<HTMLButtonElement>('resume'),
  stop: $<HTMLButtonElement>('stop'),
  discard: $<HTMLButtonElement>('discard'),
};
const yes = $<HTMLButtonElement>('discard-yes');
const no = $<HTMLButtonElement>('discard-no');

let confirming = false;
let last: BarPayload | null = null;

function render(view: BarPayload) {
  last = view;
  if (!view.canDiscard) confirming = false;
  bar.dataset.phase = view.phase;
  bar.setAttribute('aria-label', view.labels.bar);
  title.textContent = view.title;
  time.textContent = view.time;
  time.hidden = !view.time;
  notice.textContent = view.notice ?? '';
  notice.hidden = !view.notice;
  buttons.pause.textContent = view.labels.pause;
  buttons.resume.textContent = view.labels.resume;
  buttons.stop.textContent = view.labels.stop;
  buttons.discard.textContent = view.labels.discard;
  buttons.pause.hidden = !view.canPause;
  buttons.resume.hidden = !view.canResume;
  buttons.stop.hidden = !view.canStop;
  buttons.discard.hidden = !view.canDiscard;
  confirmText.textContent = view.labels.discardConfirm;
  yes.textContent = view.labels.discardYes;
  no.textContent = view.labels.discardNo;
  main.hidden = confirming;
  confirm.hidden = !confirming;
}

const act = (action: 'pause' | 'resume' | 'stop' | 'discard') => () => void bridge.act(action).catch(() => {});
buttons.pause.addEventListener('click', act('pause'));
buttons.resume.addEventListener('click', act('resume'));
buttons.stop.addEventListener('click', act('stop'));
buttons.discard.addEventListener('click', () => {
  confirming = true;
  if (last) render(last);
  no.focus();
});
no.addEventListener('click', () => {
  confirming = false;
  if (last) render(last);
});
yes.addEventListener('click', () => {
  confirming = false;
  void bridge.act('discard').catch(() => {});
});

bridge.onView(render);
