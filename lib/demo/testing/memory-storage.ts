/**
 * An in-memory stand-in for `window.localStorage` in tests. This vitest + jsdom setup has no usable
 * localStorage (the same stand-in app/pair/page.test.tsx uses). Install with
 * `vi.stubGlobal("localStorage", createMemoryStorage())`.
 */
export interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

export function createMemoryStorage(): MemoryStorage {
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, String(value)),
    removeItem: (key) => void memory.delete(key),
    clear: () => memory.clear(),
  };
}
