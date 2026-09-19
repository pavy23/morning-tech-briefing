// src/config.mjs
// 브리핑 주제 설정 로더. 저장소 루트의 briefing.config.json 하나로
// 수집 프롬프트(fetch-news), 메일 디자인(email-template), Jev 판정(judge)이 같은 카테고리를 쓴다.
// 다른 경로를 쓰려면 BRIEFING_CONFIG=경로 로 지정.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = process.env.BRIEFING_CONFIG
  || fileURLToPath(new URL("../briefing.config.json", import.meta.url));

// 색상을 지정하지 않은 카테고리에 순서대로 배정할 기본 팔레트 (다크 배경 기준)
const PALETTE = [
  { color: "#00D4FF", bg: "#0a2730" },
  { color: "#B06EFF", bg: "#1d1530" },
  { color: "#FF6B35", bg: "#301a12" },
  { color: "#00FF9D", bg: "#0a2a1d" },
  { color: "#FFC832", bg: "#302812" },
  { color: "#FF5C8A", bg: "#301220" },
  { color: "#7DD3FC", bg: "#0c2233" },
  { color: "#C4B5FD", bg: "#1e1a30" },
];

function fail(msg) {
  throw new Error(`briefing.config.json 오류: ${msg} (${CONFIG_PATH})`);
}

function loadConfig() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    fail(`읽기/파싱 실패 — ${e.message}`);
  }

  if (!Array.isArray(raw.categories) || raw.categories.length === 0) fail("categories가 비어 있습니다");
  const keys = raw.categories.map((c) => c?.key);
  if (keys.some((k) => typeof k !== "string" || !k.trim())) fail("모든 카테고리에 문자열 key가 필요합니다");
  if (new Set(keys).size !== keys.length) fail("카테고리 key가 중복됩니다");

  const total = Number.isInteger(raw.total) && raw.total > 0 ? raw.total : 10;

  // count가 없는 카테고리에는 남는 개수를 고르게 배분
  const fixed = raw.categories.reduce((s, c) => s + (Number.isInteger(c.count) && c.count >= 0 ? c.count : 0), 0);
  const unfixed = raw.categories.filter((c) => !Number.isInteger(c.count) || c.count < 0);
  if (fixed > total) fail(`count 합계(${fixed})가 total(${total})보다 큽니다`);
  const share = unfixed.length ? Math.floor((total - fixed) / unfixed.length) : 0;
  let remainder = unfixed.length ? (total - fixed) - share * unfixed.length : 0;

  const categories = raw.categories.map((c, i) => {
    const pal = PALETTE[i % PALETTE.length];
    let count = c.count;
    if (!Number.isInteger(count) || count < 0) {
      count = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
    }
    return {
      key: c.key.trim(),
      count,
      color: typeof c.color === "string" && c.color ? c.color : pal.color,
      bg: typeof c.bg === "string" && c.bg ? c.bg : pal.bg,
      description: typeof c.description === "string" && c.description ? c.description : null,
    };
  });

  const topicLabel = typeof raw.topicLabel === "string" && raw.topicLabel
    ? raw.topicLabel
    : categories.map((c) => c.key).join(" · ");

  // Jev 선별이 켜져 있을 때 Gemini에 요청할 후보 수. 재탕·중복을 뺀 빈자리를 채우려면 여유가 필요하다.
  const candidates = Number.isInteger(raw.candidates) && raw.candidates > total ? raw.candidates : total * 2;

  return {
    path: CONFIG_PATH,
    title: typeof raw.title === "string" && raw.title ? raw.title : "Morning Tech Briefing",
    subjectLabel: typeof raw.subjectLabel === "string" && raw.subjectLabel ? raw.subjectLabel : "브리핑",
    topicLabel,
    searchScope: typeof raw.searchScope === "string" && raw.searchScope ? raw.searchScope : `${topicLabel} 분야`,
    total,
    candidates,
    categories,
  };
}

export const config = loadConfig();
export const categoryKeys = config.categories.map((c) => c.key);
export const categoryMap = Object.fromEntries(config.categories.map((c) => [c.key, c]));
export const defaultCategory = config.categories[0];

// 카테고리별 권장 개수를 n건 기준으로 비례 배분 (최대 나머지 방식). n === total이면 설정값 그대로.
export function quotasFor(n, cfg = config) {
  const exact = cfg.categories.map((c) => (c.count * n) / cfg.total);
  const counts = exact.map(Math.floor);
  let remainder = n - counts.reduce((a, b) => a + b, 0);
  const byFrac = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byFrac) {
    if (remainder <= 0) break;
    counts[i]++;
    remainder--;
  }
  return cfg.categories.map((c, i) => ({ key: c.key, count: counts[i] }));
}

// 모델이 돌려준 카테고리를 설정의 key로 정규화 (대소문자/공백 차이 허용). 못 찾으면 null.
export function normalizeCategory(value) {
  const v = String(value ?? "").trim();
  if (categoryMap[v]) return v;
  const lower = v.toLowerCase();
  return categoryKeys.find((k) => k.toLowerCase() === lower) ?? null;
}
