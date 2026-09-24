import { cpSync, rmSync } from "node:fs";
rmSync("site-dist/docs", { recursive: true, force: true });
cpSync(".docs/site", "site-dist/docs", { recursive: true });
cpSync("docs/media", "site-dist/docs/media", { recursive: true });
