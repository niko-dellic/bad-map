import { rmSync } from "node:fs";

// Inline workers are part of bad-map.js. Vite still writes their standalone
// source maps even though no runtime file references them.
rmSync(new URL("../dist/assets", import.meta.url), {
  force: true,
  recursive: true,
});
