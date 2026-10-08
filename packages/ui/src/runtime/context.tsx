import { createContext, useContext } from 'react';
import { RT } from './runtime-copy.ts';
import type { RuntimeSession } from './session.ts';

export const RuntimeContext = createContext<RuntimeSession | null>(null);

export function useRuntime(): RuntimeSession {
  const session = useContext(RuntimeContext);
  if (!session) throw new Error(RT.missingContext);
  return session;
}
