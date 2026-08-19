import { readFileSync } from "node:fs";

const tag = process.argv[2];
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

if (tag !== `v${version}`) {
  console.error(
    `Release tag ${tag ?? "<missing>"} does not match package v${version}.`,
  );
  process.exitCode = 1;
}
