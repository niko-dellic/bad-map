import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    outDir: "site-dist",
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, "index.html"),
        demo: resolve(import.meta.dirname, "demo/index.html"),
      },
    },
    sourcemap: true,
  },
});
