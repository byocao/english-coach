// Kitsu, Wancha's own fox companion: an original SVG drawing (no third-party licence), animated with CSS.
// Moods change the face; the body breathes, the eyes blink and the tail wags.
import { useState } from "react";
import type { Mood, Shot } from "./Mascot";

const INK = "#4a2a1e";
const FUR = "#f28a3d";
const FUR_DEEP = "#e0702a";
const CREAM = "#fff3e2";
const EAR_IN = "#ffc9a8";

function Eyes({ mood }: { mood: Mood }) {
  if (mood === "happy" || mood === "cheer") {
    return (
      <g fill="none" stroke={INK} strokeWidth={3.6} strokeLinecap="round">
        <path d="M72 97 Q80 87 88 97" />
        <path d="M112 97 Q120 87 128 97" />
      </g>
    );
  }
  if (mood === "oops") {
    return (
      <g fill="none" stroke={INK} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M73 89 L85 95 L73 101" />
        <path d="M127 89 L115 95 L127 101" />
      </g>
    );
  }
  const big = mood === "surprised";
  const dy = mood === "think" ? -3 : mood === "sad" ? 3 : 0;
  const dx = mood === "think" ? 2 : 0;
  return (
    <g className="fox-eyes">
      <ellipse cx={80 + dx} cy={96 + dy} rx={big ? 8 : 6.2} ry={big ? 9 : 8} fill={INK} />
      <ellipse cx={120 + dx} cy={96 + dy} rx={big ? 8 : 6.2} ry={big ? 9 : 8} fill={INK} />
      <circle cx={82.5 + dx} cy={92.5 + dy} r={2.3} fill="#fff" />
      <circle cx={122.5 + dx} cy={92.5 + dy} r={2.3} fill="#fff" />
      {mood === "sad" && (
        <g fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round">
          <path d="M71 84 L86 80" />
          <path d="M129 84 L114 80" />
        </g>
      )}
    </g>
  );
}

function Mouth({ mood }: { mood: Mood }) {
  if (mood === "happy" || mood === "cheer") return <path d="M91 112 Q100 126 109 112 Z" fill="#c8504f" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />;
  if (mood === "surprised") return <ellipse cx={100} cy={117} rx={4.5} ry={5.5} fill={INK} />;
  if (mood === "sad" || mood === "oops") return <path d="M93 118 Q100 112 107 118" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />;
  if (mood === "think") return <path d="M95 116 Q101 114 106 116" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />;
  return <path d="M92 112 Q96 117.5 100 112.5 Q104 117.5 108 112" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />;
}

export function Fox({ mood = "idle", shot = "full" }: { mood?: Mood; shot?: Shot }) {
  const [hop, setHop] = useState(0);
  const droop = mood === "sad" || mood === "oops";
  return (
    <svg
      className={`fox-svg mood-${mood}${hop ? " hop" : ""}`}
      key={hop}
      viewBox={shot === "bust" ? "22 14 156 136" : "0 0 200 220"}
      preserveAspectRatio={shot === "bust" ? "xMidYMid meet" : "xMidYMax meet"}
      onClick={() => setHop((h) => h + 1)}
      role="img"
      aria-label="Kitsu"
    >
      <ellipse cx={100} cy={209} rx={58} ry={7} className="fox-shadow" />
      <g className="fox-tail">
        <path
          d="M124 188 C 172 194, 199 152, 186 112 C 180 94, 160 90, 149 104 C 163 124, 158 152, 122 168 Z"
          fill={FUR}
          stroke={INK}
          strokeWidth={3}
          strokeLinejoin="round"
        />
        <path d="M186 112 C 180 94, 160 90, 149 104 C 156 111, 160 118, 162 128 C 173 126, 183 121, 186 112 Z" fill={CREAM} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      </g>
      <g className="fox-body">
        <path d="M60 197 C 54 160, 66 127, 100 123 C 134 127, 146 160, 140 197 Z" fill={FUR} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        <ellipse cx={100} cy={170} rx={24} ry={27} fill={CREAM} />
        <ellipse cx={83} cy={198} rx={13} ry={7.5} fill={CREAM} stroke={INK} strokeWidth={3} />
        <ellipse cx={117} cy={198} rx={13} ry={7.5} fill={CREAM} stroke={INK} strokeWidth={3} />
        <g className="fox-head">
          <g transform={droop ? "rotate(-14 66 64)" : undefined} className="fox-ear-l">
            <path d="M60 72 L 50 20 L 94 52 Z" fill={FUR} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
            <path d="M63 62 L 57 33 L 84 52 Z" fill={EAR_IN} />
            <path d="M50 20 L 53 36 L 63 30 Z" fill={INK} />
          </g>
          <g transform={droop ? "rotate(14 134 64)" : undefined} className="fox-ear-r">
            <path d="M140 72 L 150 20 L 106 52 Z" fill={FUR} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
            <path d="M137 62 L 143 33 L 116 52 Z" fill={EAR_IN} />
            <path d="M150 20 L 147 36 L 137 30 Z" fill={INK} />
          </g>
          <path
            d="M46 96 C 46 66, 70 48, 100 48 C 130 48, 154 66, 154 96 C 154 118, 140 134, 100 136 C 60 134, 46 118, 46 96 Z"
            fill={FUR}
            stroke={INK}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          {/* cheek fluff and muzzle */}
          <path d="M50 104 C 60 132, 140 132, 150 104 C 140 112, 122 108, 100 122 C 78 108, 60 112, 50 104 Z" fill={CREAM} />
          <path d="M84 60 Q100 52 116 60 Q108 70 100 80 Q92 70 84 60 Z" fill={FUR_DEEP} opacity={0.55} />
          <ellipse cx={68} cy={110} rx={8.5} ry={5} fill="#ff8fa3" opacity={0.55} />
          <ellipse cx={132} cy={110} rx={8.5} ry={5} fill="#ff8fa3" opacity={0.55} />
          <Eyes mood={mood} />
          <path d="M94.5 105.5 Q100 102.5 105.5 105.5 Q100 112 94.5 105.5 Z" fill={INK} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
          <Mouth mood={mood} />
        </g>
      </g>
    </svg>
  );
}
