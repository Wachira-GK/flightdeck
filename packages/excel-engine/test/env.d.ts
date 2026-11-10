// Vite's import.meta.glob, used by the source-scan security test.
interface ImportMeta {
  glob(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, string>;
}
