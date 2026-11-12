#!/usr/bin/env node
// Local Claude bridge for english-coach.
//
// Keeps a WebSocket open to the deployed Worker. When byocao asks for a lesson,
// a grade or an explanation, the Worker sends the job here and this script runs
// it with the Claude Code CLI (`claude -p --json-schema`) on this PC, using your
// own Claude subscription. Only byocao's requests are routed here.
//
// Config: bridge/.env (see bridge/.env.example)
//   APP_URL       https://english-coach.<you>.workers.dev  (or http://localhost:5173)
//   BRIDGE_TOKEN  same value as the Worker secret BRIDGE_TOKEN
//   CLAUDE_MODEL  optional, e.g. "opus" or "sonnet"; empty = the CLI default
//   CLAUDE_BIN    optional path to the claude executable

import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.BRIDGE_TOKEN || "";
const MODEL = process.env.CLAUDE_MODEL || "";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MAX_PARALLEL = 2;
const JOB_TIMEOUT_MS = 170_000;

if (!APP_URL || !TOKEN) {
  console.error("Set APP_URL and BRIDGE_TOKEN in bridge/.env (copy bridge/.env.example).");
  process.exit(1);
}

// Run the CLI from an empty folder so no project CLAUDE.md or settings leak in.
const workDir = mkdtempSync(join(tmpdir(), "english-coach-bridge-"));
const wsUrl = `${APP_URL.replace(/^http/, "ws")}/api/bridge/ws?token=${encodeURIComponent(TOKEN)}`;

let running = 0;
const queue = [];
let socket = null;
let backoff = 1000;

function log(...args) {
  console.log(new Date().toLocaleTimeString(), ...args);
}

function runClaude({ system, prompt, schema }) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--json-schema", JSON.stringify(schema),
      "--system-prompt", system,
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--no-session-persistence",
    ];
    if (MODEL) args.push("--model", MODEL);
    const child = spawn(CLAUDE_BIN, args, { cwd: workDir, windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("claude CLI timed out"));
    }, JOB_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`cannot start claude CLI: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed;
      try {
        parsed = JSON.parse(out);
      } catch {
        return reject(new Error(`claude CLI exited ${code}: ${(err || out).slice(0, 300)}`));
      }
      if (parsed.is_error) return reject(new Error(String(parsed.result || parsed.subtype || "claude error").slice(0, 300)));
      if (parsed.structured_output) return resolve(parsed.structured_output);
      try {
        return resolve(JSON.parse(parsed.result));
      } catch {
        return reject(new Error("claude did not return JSON"));
      }
    });
    child.stdin.end(prompt);
  });
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    const started = Date.now();
    log(`job ${job.id.slice(0, 8)} started`);
    runClaude(job)
      .then((result) => {
        log(`job ${job.id.slice(0, 8)} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        send({ type: "result", id: job.id, ok: true, result });
      })
      .catch((e) => {
        log(`job ${job.id.slice(0, 8)} failed: ${e.message}`);
        send({ type: "result", id: job.id, ok: false, error: e.message });
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

function send(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function connect() {
  log(`connecting to ${APP_URL} ...`);
  const ws = new WebSocket(wsUrl);
  socket = ws;
  let pinger = null;

  ws.addEventListener("open", () => {
    backoff = 1000;
    log("bridge online — Claude requests from byocao will run on this PC");
    pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
  });
  ws.addEventListener("message", (ev) => {
    if (ev.data === "pong") return;
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "job") {
      queue.push(msg);
      pump();
    }
  });
  ws.addEventListener("close", (ev) => {
    clearInterval(pinger);
    if (ev.code === 4000) {
      log("another bridge connected and replaced this one; exiting");
      process.exit(0);
    }
    log(`disconnected (${ev.code}); retrying in ${backoff / 1000}s`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60_000);
  });
  ws.addEventListener("error", () => {
    /* close follows */
  });
}

connect();
