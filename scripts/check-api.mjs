import { readFileSync } from "node:fs";

const expected = readFileSync("test/fixtures/public-api.d.ts", "utf8").trim();
const actual = ["index.d.ts", "basemap/low-res-basemap.d.ts"]
  .map(
    (file) => `// dist/${file}\n${readFileSync(`dist/${file}`, "utf8").trim()}`,
  )
  .join("\n\n");

if (actual !== expected) {
  console.error(
    "Public API declarations changed. Review the diff and update test/fixtures/public-api.d.ts intentionally.",
  );
  process.exitCode = 1;
}
