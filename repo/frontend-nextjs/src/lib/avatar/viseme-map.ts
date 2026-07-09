export type VisemeId =
  | "sil"
  | "PP"
  | "FF"
  | "TH"
  | "DD"
  | "kk"
  | "CH"
  | "SS"
  | "nn"
  | "RR"
  | "aa"
  | "E"
  | "I"
  | "O"
  | "U";

export type VisemeKey = "jawOpen" | "mouthPucker" | "mouthFunnel" | "mouthSmile" | "mouthStretch" | "mouthClose" | "mouthRollLower" | "mouthRollUpper" | "mouthPressL" | "mouthPressR" | "mouthLowerDownL" | "mouthLowerDownR";

export type VisemeWeights = Partial<Record<VisemeKey, number>> & { jawOpen?: number };

export const VISEME_MAP: Record<VisemeId, VisemeWeights> = {
  sil:  { jawOpen: 0,    mouthSmile: 0,   mouthPucker: 0,   mouthFunnel: 0,   mouthStretch: 0,   mouthClose: 0 },
  PP:   { jawOpen: 0.18, mouthSmile: 0,   mouthPucker: 0.55, mouthFunnel: 0.4, mouthStretch: 0,   mouthClose: 0.7 },
  FF:   { jawOpen: 0.15, mouthSmile: 0,   mouthPucker: 0.3,  mouthFunnel: 0.2, mouthStretch: 0,   mouthLowerDownL: 0.4, mouthLowerDownR: 0.4 },
  TH:   { jawOpen: 0.32, mouthSmile: 0,   mouthPucker: 0,    mouthFunnel: 0,   mouthStretch: 0.45, mouthClose: 0.2 },
  DD:   { jawOpen: 0.45, mouthSmile: 0,   mouthPucker: 0,    mouthFunnel: 0,   mouthStretch: 0.2,  mouthClose: 0.3 },
  kk:   { jawOpen: 0.55, mouthSmile: 0.1, mouthPucker: 0,    mouthFunnel: 0,   mouthStretch: 0.1,  mouthClose: 0 },
  CH:   { jawOpen: 0.35, mouthSmile: 0,   mouthPucker: 0.5,  mouthFunnel: 0.4, mouthStretch: 0,   mouthClose: 0 },
  SS:   { jawOpen: 0.25, mouthSmile: 0.45, mouthPucker: 0,   mouthFunnel: 0,   mouthStretch: 0.55, mouthClose: 0 },
  nn:   { jawOpen: 0.3,  mouthSmile: 0,   mouthPucker: 0,    mouthFunnel: 0,   mouthStretch: 0,   mouthClose: 0.3 },
  RR:   { jawOpen: 0.45, mouthSmile: 0,   mouthPucker: 0.25, mouthFunnel: 0,   mouthStretch: 0,   mouthRollLower: 0.4 },
  aa:   { jawOpen: 0.85, mouthSmile: 0,   mouthPucker: 0,    mouthFunnel: 0,   mouthStretch: 0.1,  mouthClose: 0 },
  E:    { jawOpen: 0.6,  mouthSmile: 0.55, mouthPucker: 0,   mouthFunnel: 0,   mouthStretch: 0.6,  mouthClose: 0 },
  I:    { jawOpen: 0.4,  mouthSmile: 0.45, mouthPucker: 0,   mouthFunnel: 0,   mouthStretch: 0.4,  mouthClose: 0 },
  O:    { jawOpen: 0.55, mouthSmile: 0,   mouthPucker: 0.65, mouthFunnel: 0.55, mouthStretch: 0,   mouthClose: 0 },
  U:    { jawOpen: 0.4,  mouthSmile: 0,   mouthPucker: 0.75, mouthFunnel: 0.7,  mouthStretch: 0,   mouthClose: 0 },
};

export const VISEME_ORDER: VisemeId[] = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];

export type VisemeKeyMap = { jawOpen?: string; mouthPucker?: string; mouthFunnel?: string; mouthSmile?: string; mouthStretch?: string; mouthClose?: string; mouthRollLower?: string; mouthRollUpper?: string; mouthPressL?: string; mouthPressR?: string; mouthLowerDownL?: string; mouthLowerDownR?: string };

export const VRM_EXPRESSION_ALIASES: VisemeKeyMap = {
  jawOpen: "jawOpen",
  mouthPucker: "mouthPucker",
  mouthFunnel: "mouthFunnel",
  mouthSmile: "mouthSmile",
  mouthStretch: "mouthStretch",
  mouthClose: "mouthClose",
  mouthRollLower: "mouthRollLower",
  mouthRollUpper: "mouthRollUpper",
  mouthPressL: "mouthPressL",
  mouthPressR: "mouthPressR",
  mouthLowerDownL: "mouthLowerDownL",
  mouthLowerDownR: "mouthLowerDownR",
};

const VOWELS: Record<string, VisemeId> = { a: "aa", e: "E", i: "I", o: "O", u: "U" };
const CONSONANTS: Record<string, VisemeId> = {
  p: "PP", b: "PP", m: "PP",
  f: "FF", v: "FF",
  t: "DD", d: "DD", n: "nn", l: "nn",
  k: "kk", g: "kk",
  s: "SS", z: "SS",
  r: "RR",
  w: "U", y: "I", h: "DD",
  c: "CH", j: "CH", sh: "CH", ch: "CH",
  th: "TH",
};

export function wordToViseme(word: string): VisemeId {
  const lower = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!lower) return "sil";

  for (const combo of Object.keys(CONSONANTS)) {
    if (combo.length === 2 && lower.includes(combo)) return CONSONANTS[combo];
  }

  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (VOWELS[ch]) return VOWELS[ch];
    if (CONSONANTS[ch]) return CONSONANTS[ch];
  }
  return "sil";
}

export type VisemeFrame = {
  viseme: VisemeId;
  start: number;
  end: number;
  weight: number;
};

export function interpolateViseme(timeline: VisemeFrame[], time: number): VisemeWeights {
  if (timeline.length === 0) return VISEME_MAP.sil;
  if (time <= timeline[0].start) return scaleWeights(VISEME_MAP[timeline[0].viseme], timeline[0].weight);
  if (time >= timeline[timeline.length - 1].end) {
    return VISEME_MAP.sil;
  }

  for (let i = 0; i < timeline.length; i++) {
    const f = timeline[i];
    if (time >= f.start && time <= f.end) {
      const transitionMs = 35;
      const intoFrame = (time - f.start) / 1000;
      const rampIn = Math.min(1, intoFrame / (transitionMs / 1000));
      return scaleWeights(VISEME_MAP[f.viseme], f.weight * rampIn);
    }
  }

  return VISEME_MAP.sil;
}

function scaleWeights(w: VisemeWeights, factor: number): VisemeWeights {
  const out: VisemeWeights = {};
  for (const k in w) {
    const v = w[k as VisemeKey];
    if (typeof v === "number") {
      (out as Record<string, number>)[k] = Math.max(0, Math.min(1, v * factor));
    }
  }
  return out;
}

export function buildWordTimeline(
  text: string,
  totalDurationMs: number,
): VisemeFrame[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const weights: number[] = words.map((w) => {
    const letters = w.replace(/[^a-zA-Z]/g, "").length || 1;
    const hasLong = /[aeiou]{2,}/.test(w.toLowerCase()) ? 1.3 : 1.0;
    return Math.max(0.5, Math.min(2.0, (letters / 4) * hasLong));
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const pauseChance = 0.18;

  const frames: VisemeFrame[] = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const viseme = wordToViseme(w);
    const dur = (weights[i] / totalWeight) * totalDurationMs;

    frames.push({ viseme, start: cursor, end: cursor + dur * 0.7, weight: 1.0 });

    cursor += dur * 0.7;

    if (viseme !== "sil") {
      frames.push({ viseme: "sil", start: cursor, end: cursor + dur * 0.15, weight: 0.4 });
      cursor += dur * 0.15;
    }

    if (Math.random() < pauseChance && i < words.length - 1) {
      frames.push({ viseme: "sil", start: cursor, end: cursor + 120, weight: 0 });
      cursor += 120;
    }
  }

  return frames;
}
