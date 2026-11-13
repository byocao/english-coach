// Kitsu, Wancha's own fox companion: an original low-poly "papercraft" SVG, lit from the upper right
// (light top facets, darker sides and shadows), animated with CSS. The body breathes, the head tilts,
// the tail sways, the ears twitch and the eyes blink; moods change the eyes and the pose; a tap hops.
import { useState } from "react";
import type { Mood, Shot } from "./Mascot";

type Facet = [points: string, fill: string];

// Paper oranges from lit to shaded, cream, and dark browns.
const O1 = "#f7b46a";
const O2 = "#f2a050";
const O3 = "#ea8c38";
const O4 = "#df7a2b";
const O5 = "#cf6a22";
const O6 = "#b8591b";
const C1 = "#f8efdd";
const C2 = "#efe3c9";
const C3 = "#ded0b2";
const B1 = "#7d4c2d";
const B2 = "#6a3f25";
const B3 = "#55321d";
const INK = "#2f1d13";

const TAIL: Facet[] = [
  ["104,226 78,212 70,232", O2],
  ["104,226 70,232 100,244", O4],
  ["78,212 52,218 70,232", O3],
  ["52,218 40,236 70,232", O5],
  ["70,232 40,236 70,250", O6],
  ["70,250 100,244 70,232", O5],
  ["52,218 34,230 40,236", C2],
  ["34,230 24,246 40,236", C1],
  ["40,236 24,246 40,252", C3],
  ["40,252 70,250 40,236", C2],
];

const BODY: Facet[] = [
  // back and left flank (away from the light)
  ["62,104 73,118 67,140 58,128", O5],
  ["58,128 67,140 80,160 61,166", O4],
  ["61,166 80,160 90,186 69,201", O5],
  ["69,201 90,186 92,210 76,216", O6],
  // right shoulder, side and the round haunch (towards the light)
  ["130,121 141,140 118,152", O2],
  ["118,152 141,140 151,166 128,174", O3],
  ["128,174 151,166 163,196 141,206", O1],
  ["141,206 163,196 165,221 151,236", O2],
  ["128,174 141,206 120,212 112,182", O4],
  ["120,212 141,206 151,236 126,236", O5],
  ["151,236 165,221 160,241", O6],
  ["112,182 120,212 106,226 100,206", O5],
];

const CHEST: Facet[] = [
  ["72,118 112,124 96,148", C1],
  ["112,124 130,121 118,152 96,148", C2],
  ["72,118 96,148 80,160", C3],
  ["80,160 96,148 118,152 104,178", C1],
  ["80,160 104,178 100,206 90,186", C3],
  ["104,178 118,152 112,182 100,206", C2],
];

const LEGS: Facet[] = [
  ["122,236 150,236 156,247 124,248", B2], // hind paw
  ["140,240 156,247 146,248", B3],
  ["78,193 89,193 91,246 80,247", B2], // front legs
  ["84,193 89,193 91,246 86,246", B1],
  ["94,197 106,195 110,250 98,251", B1],
  ["94,197 99,197 102,251 98,251", B2],
  ["77,246 92,246 95,253 75,253", B3], // front paws
  ["96,249 111,248 114,256 94,256", B3],
];

const EAR_L: Facet[] = [
  ["70,82 75,46 82,70", O6],
  ["75,46 94,66 82,70", O4],
  ["77,53 89,65 82,69", B3],
];
const EAR_R: Facet[] = [
  ["113,63 135,45 127,72", O3],
  ["116,64 132,50 127,70", B3],
  ["135,45 131,80 127,72", O5],
];

const HEAD: Facet[] = [
  ["113,63 127,72 131,80", O4], // under the right ear, shows when it droops
  ["94,66 113,63 104,72", O1], // crown
  ["82,70 94,66 104,72", O2],
  ["70,82 82,70 104,72 90,92", O3], // forehead, left
  ["104,72 113,63 124,90 106,86", O2], // forehead, right
  ["113,63 131,80 124,90", O3],
  ["90,92 104,72 106,86", O3], // brow between the eyes
  ["70,82 90,92 78,104 62,104", O5], // left cheek in shade
  ["90,92 106,86 100,100", O4],
  ["78,104 90,92 100,100", O5],
  ["106,86 124,90 122,103 100,100", "#f4aa5d"], // lit bridge of the snout
  ["124,90 131,80 136,100 122,103", O4],
  ["122,103 136,100 142,116", O2],
  // cream muzzle and jaw
  ["100,100 122,103 142,116 134,121 112,124", C1],
  ["78,104 100,100 112,124 88,120", C2],
  ["62,104 78,104 88,120 73,117", C3],
];

function Facets({ list }: { list: Facet[] }) {
  return (
    <>
      {list.map(([p, f], i) => (
        <polygon key={i} points={p} fill={f} stroke={f} strokeWidth={0.7} strokeLinejoin="round" />
      ))}
    </>
  );
}

function Eyes({ mood }: { mood: Mood }) {
  if (mood === "happy" || mood === "cheer") {
    return (
      <g fill="none" stroke={INK} strokeWidth={2.1} strokeLinecap="round">
        <path d="M86 96 Q91.5 91 97 95.5" />
        <path d="M113 93.5 Q118.5 88.5 124 93" />
      </g>
    );
  }
  if (mood === "sad" || mood === "oops") {
    return (
      <g fill={INK}>
        <polygon points="86,93.5 97,96.5 95.5,97.8" />
        <polygon points="124,91 113,94.5 114.6,95.8" />
      </g>
    );
  }
  if (mood === "surprised" || mood === "think") {
    const up = mood === "think" ? -1.2 : 0;
    return (
      <g className="fox-eyes" fill={INK}>
        <polygon points={`86,${94.5 + up} 92,${90.5 + up} 98,${94 + up} 92,${97.5 + up}`} />
        <polygon points={`113,${92 + up} 119,${88 + up} 125,${91.5 + up} 119,${95 + up}`} />
        <circle cx={93.6} cy={92.6 + up} r={1.1} fill="#fff" />
        <circle cx={120.6} cy={90.1 + up} r={1.1} fill="#fff" />
      </g>
    );
  }
  // idle: calm, closed paper-fold eyes
  return (
    <g fill={INK}>
      <polygon points="86,95 97,93.6 96,95.6" />
      <polygon points="113,92.6 124,91 123,93" />
    </g>
  );
}

export function Fox({ mood = "idle", shot = "full" }: { mood?: Mood; shot?: Shot }) {
  const [hop, setHop] = useState(0);
  return (
    <svg
      className={`fox-svg mood-${mood}${shot === "bust" ? " bust" : ""}${hop ? " hop" : ""}`}
      key={hop}
      viewBox={shot === "bust" ? "46 38 110 110" : "0 34 200 230"}
      preserveAspectRatio={shot === "bust" ? "xMidYMid meet" : "xMidYMax meet"}
      onClick={() => setHop((h) => h + 1)}
      role="img"
      aria-label="Kitsu"
    >
      <ellipse cx={96} cy={256} rx={74} ry={5.5} className="fox-shadow" />
      <g className="fox-tail">
        <Facets list={TAIL} />
      </g>
      <g className="fox-body">
        <Facets list={BODY} />
        <Facets list={CHEST} />
        <Facets list={LEGS} />
        <g className="fox-head">
          <g className="fox-ear-l">
            <Facets list={EAR_L} />
          </g>
          <g className="fox-ear-r">
            <Facets list={EAR_R} />
          </g>
          <Facets list={HEAD} />
          <polygon points="136,112.5 143.5,116 137,121" fill={INK} />
          <Eyes mood={mood} />
          {(mood === "happy" || mood === "cheer") && <path d="M126 122.5 Q130 124.5 134 122" fill="none" stroke={INK} strokeWidth={1.5} strokeLinecap="round" />}
        </g>
      </g>
    </svg>
  );
}
