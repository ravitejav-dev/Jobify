#!/usr/bin/env node
// Lightweight auto-pull watcher for your personal laptop while iterating in Jetski.
// Usage on personal laptop: node backend/dev_sync.mjs

import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 5000);

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

console.log(`🔄 Jobify Live Sync Watcher started in ${ROOT}`);
console.log(`   Polling origin/main every ${INTERVAL_MS / 1000}s — whenever changes are pushed, this auto-pulls them.`);
console.log(`   After an update lands, click the [↻] button inside Jobify Popup or Copilot Drawer!\n`);

async function tick() {
  try {
    git("fetch", "origin", "main", "--quiet");
    const localSha = git("rev-parse", "HEAD");
    const remoteSha = git("rev-parse", "origin/main");
    if (localSha !== remoteSha) {
      const summary = git("log", "--oneline", `${localSha}..${remoteSha}`);
      git("pull", "--rebase", "--autostash", "origin", "main");
      const now = new Date().toLocaleTimeString();
      process.stdout.write("\x07");
      console.log(`\n[${now}] ✅ Synced new commit(s) from GitHub:\n${summary}`);
      console.log(`👉 Click [↻] in Jobify Popup or Copilot Drawer to hot-reload immediately.\n`);
    }
  } catch (err) {
    console.error(`⚠️ Sync check skipped: ${err.message?.split("\n")[0]}`);
  }
}

setInterval(tick, INTERVAL_MS);
tick();
