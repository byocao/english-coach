#!/usr/bin/env node
// Downloads the Live2D characters (Wanko, plus any extras such as Tororo & Hijiki) and the Cubism Core runtime into public/live2d/.
//
// Wanko is an official Live2D sample model (a "Live2D Original Character"),
// usable by individuals and small businesses under the Live2D Free Material License, with
// credit. That license forbids redistributing the raw model files, so they are NOT committed
// to git (public/live2d/ is gitignored): this script fetches them before every build, and the
// deployed app serves them only as part of the app. Cubism Core comes from Live2D's own CDN
// (Live2D Proprietary Software License, redistributable inside an app).
//
//   https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html
//   https://www.live2d.com/en/learn/sample/

import { access, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

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
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  const refs = settings.FileReferences;
  const files = [refs.Moc, ...refs.Textures, refs.Physics, refs.Pose, refs.DisplayInfo, refs.UserData].filter(Boolean);
  for (const e of refs.Expressions ?? []) files.push(e.File);
  for (const group of Object.values(refs.Motions ?? {})) for (const m of group) files.push(m.File); // (sounds are skipped)
  for (const f of files) await get(`${RAW}/${name}/${f}`, join(dir, f));
  return files.length;
}

/** Wanko ships more motions than its settings list: add a "Shake" group (used for wrong answers). */
async function extendWanko() {
  const dir = join(root, "Wanko");
  const path = join(dir, "Wanko.model3.json");
  const settings = JSON.parse(await readFile(path, "utf8"));
  const motions = settings.FileReferences.Motions;
  if (motions.Shake) return;
  for (const f of ["shake_01", "shake_02", "touch_01", "touch_03"]) await get(`${RAW}/Wanko/motions/${f}.motion3.json`, join(dir, "motions", `${f}.motion3.json`));
  motions.Shake = [{ File: "motions/shake_01.motion3.json" }, { File: "motions/shake_02.motion3.json" }];
  motions.TapBody.push({ File: "motions/touch_01.motion3.json" }, { File: "motions/touch_03.motion3.json" });
  await writeFile(path, JSON.stringify(settings, null, 2));
}

/**
 * Wancha's Wanko sits in a matcha-latte bowl: turns the red lacquer bowl, its saucer and the orange glow
 * under it green (Live2D Original Characters may be altered under the Free Material License).
 * Only reds/oranges in the bowl's part of the texture atlas change; dark outlines and the pink cheeks
 * stay. Re-running is harmless: pixels already green no longer match.
 */
async function matchaWanko() {
  const path = join(root, "Wanko", "Wanko.1024", "texture_00.png");
  if (!(await exists(path))) return;
  const png = PNG.sync.read(await readFile(path));
  const { width, data } = png;
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const x = (i / 4) % width;
    const y = Math.floor(i / 4 / width);
    if (x >= 520 || y >= 780) continue; // bowl, saucer and glow live in this part of the atlas
    if ((x >= 385 && y >= 485 && y <= 535) || (x >= 440 && y >= 448 && y < 485)) continue; // eyes, nose, brows
    if (x >= 460 && y >= 340 && y <= 440) continue; // and an ear
    const [h, sat, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const reddish = h >= 330 || h <= 45;
    // Lacquer reds are saturated or light; the dark-brown outlines (like the dog's) are neither.
    const pawPrint = x >= 280 && x < 480 && y >= 600 && y < 740; // dark-red pads on the saucer, no outlines there
    if (!reddish || l > 0.93 || !(sat >= 0.5 || l >= 0.3 || (pawPrint && sat >= 0.3 && l >= 0.12))) continue;
    const off = h >= 330 ? h - 360 : h; // -30..45, keeps the wood-grain shading
    const nh = 86 + off * 0.35;
    const ns = Math.min(0.62, Math.max(0.22, sat * 0.55));
    const nl = Math.min(0.95, l + (1 - l) * 0.12);
    [data[i], data[i + 1], data[i + 2]] = hslToRgb(nh, ns, nl);
    changed++;
  }
  if (changed > 0) {
    await writeFile(path, PNG.sync.write(png));
    console.log(`live2d: Wanko's bowl recoloured to matcha (${changed} pixels)`);
  }
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const t = (n) => {
    if (n < 0) n += 1;
    if (n > 1) n -= 1;
    if (n < 1 / 6) return p + (q - p) * 6 * n;
    if (n < 1 / 2) return q;
    if (n < 2 / 3) return p + (q - p) * (2 / 3 - n) * 6;
    return p;
  };
  return [t(h + 1 / 3), t(h), t(h - 1 / 3)].map((v) => Math.round(v * 255));
}

/**
 * Extra models the owner downloaded by hand (e.g. Tororo & Hijiki from live2d.com, which asks you to
 * accept its terms first): unzip them anywhere under live2d-extra/ and every *.model3.json found there
 * is copied into public/live2d/<name>/.
 */
async function extras(manifest) {
  const base = join(root, "..", "..", "live2d-extra");
  if (!(await exists(base))) return;
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".model3.json")) {
        const name = e.name.replace(".model3.json", "");
        const key = name.toLowerCase();
        await cp(dir, join(root, `x-${key}`), { recursive: true });
        manifest[key] = `/live2d/x-${key}/${e.name}`;
        console.log(`live2d: extra model ${name} added`);
      }
    }
  };
  await walk(base);
}

try {
  await get(CORE_URL, join(root, "live2dcubismcore.min.js"));
  for (const name of ["Wanko"]) console.log(`live2d: ${name} ready (${await model(name)} files)`);
  await extendWanko();
  await matchaWanko();
  const manifest = {
    wanko: "/live2d/Wanko/Wanko.model3.json",
  };
  await extras(manifest);
  await writeFile(join(root, "models.json"), JSON.stringify(manifest, null, 2));
} catch (err) {
  // The app still works without the characters (it shows a static avatar), so never fail the build.
  console.warn(`live2d: could not fetch characters: ${err.message}`);
}
