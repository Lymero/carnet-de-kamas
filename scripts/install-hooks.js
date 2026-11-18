#!/usr/bin/env node
/**
 * @file Points git at the versioned hooks in .githooks/. Run by `npm install` / `npm ci`
 * through the "prepare" script, so every clone gets the same checks automatically.
 * Skipped in CI (hooks are not needed there) and outside a git checkout.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.CI || !existsSync(new URL("../.git", import.meta.url))) process.exit(0);

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  console.log("Git hooks enabled: checks run before each commit (.githooks/pre-commit) and push (.githooks/pre-push).");
} catch {
  console.warn("Could not enable the git hooks. Run: git config core.hooksPath .githooks");
}
