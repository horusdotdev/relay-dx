import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
execFileSync("vp", ["pack"], { cwd, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/prepare-fixture.ts"], { cwd, stdio: "inherit" });
