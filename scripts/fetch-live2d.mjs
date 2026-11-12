#!/usr/bin/env node
// Downloads the two Live2D characters and the Cubism Core runtime into public/live2d/.
//
// Hiyori Momose and Haru are official Live2D sample models ("Live2D Original Characters"),
// usable by individuals and small businesses under the Live2D Free Material License, with
// credit. That license forbids redistributing the raw model files, so they are NOT committed
// to git (public/live2d/ is gitignored): this script fetches them before every build, and the
// deployed app serves them only as part of the app. Cubism Core comes from Live2D's own CDN
// (Live2D Proprietary Software License, redistributable inside an app).
//
//   https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html
//   https://www.live2d.com/en/learn/sample/

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "live2d");
// Pinned commit of github.com/Live2D/CubismWebSamples
const REF = "b1de66b0b1f1cb881d95fb6158622aeb6a2827bd";
const RAW = `https://raw.githubusercontent.com/Live2D/CubismWebSamples/${REF}/Samples/Resources`;
const CORE_URL = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function get(url, dest) {
  if (await exists(dest)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function model(name) {
  const dir = join(root, name);
  const settingsPath = join(dir, `${name}.model3.json`);
  await get(`${RAW}/${name}/${name}.model3.json`, settingsPath);
  const settings = JSON.parse(await (await import("node:fs/promises")).readFile(settingsPath, "utf8"));
  const refs = settings.FileReferences;
  const files = [refs.Moc, ...refs.Textures, refs.Physics, refs.Pose, refs.DisplayInfo, refs.UserData].filter(Boolean);
  for (const e of refs.Expressions ?? []) files.push(e.File);
  for (const group of Object.values(refs.Motions ?? {})) for (const m of group) files.push(m.File); // (sounds are skipped)
  for (const f of files) await get(`${RAW}/${name}/${f}`, join(dir, f));
  return files.length;
}

try {
  await get(CORE_URL, join(root, "live2dcubismcore.min.js"));
  for (const name of ["Hiyori", "Haru"]) console.log(`live2d: ${name} ready (${await model(name)} files)`);
} catch (err) {
  // The app still works without the characters (it shows a static avatar), so never fail the build.
  console.warn(`live2d: could not fetch characters: ${err.message}`);
}
