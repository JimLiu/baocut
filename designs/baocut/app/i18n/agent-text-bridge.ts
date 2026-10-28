import { messagesFor } from './agent-text-copy.ts';

Object.assign(window, { BC_AGENT_TEXT_COPY: {
  forLanguage: (preference: string) => messagesFor(preference, navigator.languages),
} });
