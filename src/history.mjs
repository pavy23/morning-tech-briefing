// src/history.mjs
// 최근 발송 브리핑의 헤드라인 이력. "전날 재탕" 판정의 근거로 쓴다.
// 파일은 저장소에 커밋하지 않고 GitHub Actions 캐시(.briefing-state/)로 하루 단위로 이어 받는다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const HISTORY_FILE = process.env.BRIEFING_HISTORY_FILE || ".briefing-state/history.json";
// 이 일수만큼만 보관 (재탕 판정 범위이자 파일 크기 상한)
const KEEP_DAYS = 14;

export function todayKst(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD
}

// [{ date: "2026-09-18", items: [{ headline, category, url }] }, ...] (오래된 날 → 최근 날 순)
export async function loadHistory(file = HISTORY_FILE) {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.days) ? parsed.days : [];
  } catch (e) {
    if (e.code !== "ENOENT") console.error(`[history] 읽기 실패, 빈 이력으로 진행: ${e.message}`);
    return [];
  }
}

// 오늘 발송분을 이력에 반영하고 저장. 같은 날짜가 이미 있으면 덮어쓴다(수동 재실행 대비).
export async function appendHistory(days, date, items, file = HISTORY_FILE) {
  const entry = {
    date,
    items: items.map((it) => ({ headline: it.headline, category: it.category, url: it.url })),
  };
  const next = [...days.filter((d) => d.date !== date), entry]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-KEEP_DAYS);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ days: next }, null, 2));
  return next;
}

// 재탕 판정에 넘길 "이전 브리핑 헤드라인" 목록 (오늘 날짜는 제외: 수동 재실행 시 자기 자신과 비교 방지)
export function previousHeadlines(days, today) {
  return days
    .filter((d) => d.date !== today)
    .flatMap((d) => d.items.map((it) => ({ date: d.date, headline: it.headline })));
}

// 수집 요청에 넣는 "최근 발송 헤드라인": 오늘을 뺀 마지막 RECENT_DAYS번의 발송분 (오래된 날 → 최근 날).
// 수집 단계에서 같은 사건을 다시 고르지 않게 해 후보를 아낀다 (2026-11-08: 후보 19건 중 9건이 재탕으로 빠져
// 남는 후보가 0건). 재탕을 최종으로 거르는 일은 여전히 Jev가 14일치 전체와 비교해 한다.
export const RECENT_DAYS = 3;
export function recentHeadlines(days, today, n = RECENT_DAYS) {
  return [...days]
    .filter((d) => d.date !== today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-n)
    .flatMap((d) => d.items.map((it) => ({ date: d.date, category: it.category, headline: it.headline })));
}

// 수집 프롬프트용 문구 (Claude·Gemini 공용). 최근 발송분이 없으면 둘 다 빈 문자열.
// "같은 사건"의 기준은 Jev 재탕 판정(judge.mjs의 SAME_EVENT_RULE)과 같게 둔다.
export function recentBlock(recent = []) {
  if (!recent.length) return "";
  const lines = recent.map((r) => `- ${r.date.slice(5)} [${r.category}] ${r.headline}`).join("\n");
  return `최근 브리핑에 이미 실린 뉴스 (이 사건들은 다시 넣지 않습니다):\n${lines}\n\n`;
}
export function recentRule(recent = []) {
  if (!recent.length) return "";
  return "\n- 위 '최근 브리핑에 이미 실린 뉴스'와 같은 사건(같은 발표·출시·계약·투자·보고서·사고·발언)은 표현이나 출처가 달라도 넣지 않습니다." +
    " 그 뒤 새로 일어난 일(새 날짜 확정, 발사 예정 → 발사, 협상 → 계약 체결 등)은 새 뉴스로 넣습니다.";
}
