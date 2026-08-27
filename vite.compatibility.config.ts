import { resolve } from "node:path";
import { defineConfig } from "vite";

const repositoryRoot = import.meta.dirname;

export default defineConfig({
  root: resolve(repositoryRoot, "e2e/compatibility"),
  optimizeDeps: {
    entries: [resolve(repositoryRoot, "e2e/compatibility/index.html")],
  },
  server: {
    fs: { allow: [repositoryRoot] },
  },
});
