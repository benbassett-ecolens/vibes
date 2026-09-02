// The claude.ai artifact viewer injects `window.claude.use()` — the entry
// point to runtime capabilities (shared db, downloads). Absent everywhere
// else, so every access must be optional.
interface Window {
  claude?: { use(name: string): Promise<unknown> }
}
