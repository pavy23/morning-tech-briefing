// src/cost.mjs
// API 사용량을 모아 비용을 추정하고, 실행마다 원장(.briefing-state/costs.json)에 쌓아
// 이번 달 누적과 월 환산(최근 발송 평균 × 30)을 계산한다.
// 단가는 공개 가격표 기준 추정치다. 실제 청구액은 Claude Console(Usage/Cost)·Google AI Studio에서 확인한다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const COST_FILE = process.env.BRIEFING_COST_FILE || ".briefing-state/costs.json";
const KEEP_RUNS = 400;
// 월 환산이 이 금액(USD)을 넘으면 메일·로그에 경고를 띄운다
export const costAlertUsd = () => {
  const raw = String(process.env.COST_ALERT_USD ?? "").trim();
  return raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : 50;
};

// USD / 100만 토큰
//  Claude: platform.claude.com/docs/en/about-claude/pricing (2026-10-08 확인).
//    Haiku 5.5는 프롬프트가 10만 토큰을 넘으면 비싼 요율. 검색 루프의 반복별 프롬프트 길이는
//    응답에 나오지 않으므로, 합산 입력이 10만을 넘으면 비싼 요율로 잡는다(상한 추정).
//  웹 검색: 1,000회당 $10 (같은 문서). 실패한 검색은 과금되지 않는다.
//  Gemini 3.6 Flash: 2026-12-31까지 도입가 $0.75/$3.75, 2027-01-01부터 $1.50/$7.50 (thinking 토큰은 출력 요율).
//  TypeSafe Jev: 입력 $0.042, 출력 무료 (README 비용 표).
const PRICES = {
  "claude-sonnet-5-5": () => ({ input: 2, output: 10, cacheRead: 0.10, cacheWrite: 2.50 }),
  "claude-opus-5-5": () => ({ input: 4, output: 20, cacheRead: 0.20, cacheWrite: 5 }),
  "claude-haiku-5-5": (_date, u) => (u.input + u.cacheRead + u.cacheWrite > 100_000
    ? { input: 0.50, output: 2.50, cacheRead: 0.05, cacheWrite: 0.625 }
    : { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 }),
  "gemini-3.6-flash": (date) => (date < "2027-01-01" ? { input: 0.75, output: 3.75 } : { input: 1.50, output: 7.50 }),
  jev: () => ({ input: 0.042, output: 0 }),
};
const WEB_SEARCH_USD = 10 / 1000;

function priceFor(model, date, u) {
  const key = Object.keys(PRICES).find((k) => String(model || "").startsWith(k));
  return key ? PRICES[key](date, u) : null;
}

// entry: { provider, model, stage, input, output, cacheRead?, cacheWrite?, searches? }
// 단가를 모르는 모델이면 null (토큰만 기록)
export function estimateUsd(entry, date) {
  const u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, ...entry };
  const p = priceFor(u.model, date, u);
  if (!p) return null;
  const tokens = (u.input * p.input + u.output * p.output +
    u.cacheRead * (p.cacheRead ?? p.input) + u.cacheWrite * (p.cacheWrite ?? p.input)) / 1e6;
  return tokens + u.searches * WEB_SEARCH_USD;
}

// 이번 실행에서 쌓인 사용량. 각 호출 지점(수집·판정)이 recordUsage로 넣는다.
const entries = [];
export function recordUsage(entry) {
  entries.push({ ...entry });
}
export function runEntries() {
  return entries.map((e) => ({ ...e }));
}
// 테스트용
export function resetUsage() {
  entries.length = 0;
}

// 실행 한 번의 비용 기록을 만든다
export function buildRunRecord({ date, at = new Date(), trigger, sent, model }) {
  const items = runEntries().map((e) => ({ ...e, usd: estimateUsd(e, date) }));
  const total = items.reduce((s, e) => s + (e.usd ?? 0), 0);
  return {
    date,
    at: at.toISOString(),
    trigger: trigger || "local",
    sent: Boolean(sent),
    model: model || null,
    entries: items,
    total: Math.round(total * 1e6) / 1e6,
    unpriced: items.filter((e) => e.usd == null).map((e) => e.model),
  };
}

export async function loadLedger(file = COST_FILE) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(parsed?.runs) ? parsed.runs : [];
  } catch (e) {
    if (e.code !== "ENOENT") console.error(`[cost] 원장 읽기 실패, 새로 시작: ${e.message}`);
    return [];
  }
}

export async function appendLedger(runs, record, file = COST_FILE) {
  const next = [...runs, record].slice(-KEEP_RUNS);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ runs: next }, null, 2));
  return next;
}

// 이번 달 누적(모든 실행: 운영·테스트·재시도 포함)과 월 환산(최근 발송 7회 평균 × 30)
export function costOverview(runs, today) {
  const month = today.slice(0, 7);
  const monthToDate = runs.filter((r) => r.date.startsWith(month)).reduce((s, r) => s + (r.total || 0), 0);
  // 원장은 시간순으로 쌓이지만, 손으로 고친 원장에도 맞도록 날짜·시각순으로 정렬해 최근 7회를 고른다
  const recentSent = runs
    .filter((r) => r.sent)
    .sort((a, b) => `${a.date}${a.at || ""}`.localeCompare(`${b.date}${b.at || ""}`))
    .slice(-7);
  const avg = recentSent.length ? recentSent.reduce((s, r) => s + (r.total || 0), 0) / recentSent.length : null;
  return {
    month,
    monthToDate,
    monthlyRunRate: avg == null ? null : avg * 30,
    basisRuns: recentSent.length,
    alertUsd: costAlertUsd(),
  };
}

const usd = (n) => `$${n.toFixed(2)}`;

// 메일 푸터·로그용 한 줄 요약
export function formatCostLine(record, overview) {
  const parts = [`이번 실행 ${usd(record.total)}`, `${Number(overview.month.slice(5))}월 누적 ${usd(overview.monthToDate)}`];
  if (overview.monthlyRunRate != null) {
    parts.push(`월 환산 ${usd(overview.monthlyRunRate)} (최근 발송 ${overview.basisRuns}회 평균 × 30, 경고 기준 ${usd(overview.alertUsd)})`);
  }
  if (record.unpriced.length) parts.push(`단가 미등록: ${[...new Set(record.unpriced)].join(", ")}`);
  return `API 비용(추정) ${parts.join(" · ")}`;
}

export function isOverBudget(overview) {
  return overview.monthlyRunRate != null && overview.monthlyRunRate > overview.alertUsd;
}

// GitHub Actions 실행 요약(마크다운) — 항목별 토큰·검색·비용 표
export function formatCostSummary(record, overview) {
  const rows = record.entries.map((e) =>
    `| ${e.stage || "-"} | ${e.model} | ${e.input ?? 0} | ${e.output ?? 0} | ${e.searches ?? 0} | ${e.usd == null ? "단가 미등록" : usd(e.usd)} |`);
  return [
    "### API 비용 (추정)",
    "",
    "| 단계 | 모델 | 입력 토큰 | 출력 토큰 | 웹 검색 | 비용 |",
    "|---|---|---:|---:|---:|---:|",
    ...rows,
    `| **합계** | | | | | **${usd(record.total)}** |`,
    "",
    `- ${overview.month} 누적: ${usd(overview.monthToDate)}`,
    overview.monthlyRunRate == null
      ? "- 월 환산: 발송 기록이 쌓이면 표시"
      : `- 월 환산: ${usd(overview.monthlyRunRate)} (최근 발송 ${overview.basisRuns}회 평균 × 30) / 경고 기준 ${usd(overview.alertUsd)}`,
    "",
  ].join("\n");
}
