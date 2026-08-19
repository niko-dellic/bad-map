import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    copyPublicDir: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "bad-map",
    },
    rollupOptions: {
      external: ["maplibre-gl"],
    },
    sourcemap: true,
  },
});
