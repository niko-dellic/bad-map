import { build } from "vite";

const workers = [
  ["raster", "src/workers/raster.worker.ts"],
  ["data-raster", "src/workers/data.worker.ts"],
];

for (const [name, entry] of workers)
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      copyPublicDir: false,
      emptyOutDir: false,
      lib: {
        entry,
        formats: ["es"],
        fileName: () => `${name}.js`,
      },
      outDir: "dist/workers",
      rollupOptions: {
        output: { codeSplitting: false },
      },
      sourcemap: false,
    },
  });
