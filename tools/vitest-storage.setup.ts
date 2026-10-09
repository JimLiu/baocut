// Browser stores need localStorage before their modules load. Keep each test file's
// storage in memory, independent of Node's Web Storage flags and other workers.
const data = new Map<string, string>();
const storage: Storage = {
  get length() { return data.size; },
  clear: () => data.clear(),
  getItem: (key) => data.get(String(key)) ?? null,
  key: (index) => Array.from(data.keys())[index] ?? null,
  removeItem: (key) => { data.delete(String(key)); },
  setItem: (key, value) => { data.set(String(key), String(value)); },
};

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
