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
