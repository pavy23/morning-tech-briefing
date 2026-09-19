// scripts/backtest.mjs
// 과거 발송 헤드라인(backtest/days.json)을 날짜순으로 Jev에 흘려 넣어, 실제 운영과 같은
// 롤링 이력(최근 14일)으로 재탕·중복·관련도·카테고리 판정을 한꺼번에 시험한다.
// Gemini는 호출하지 않는다. TYPESAFE_API_KEY 필요.
//
// 산출물 (backtest/):
//   results.json  날짜별 전체 판정
//   summary.md    사람이 읽는 요약 (재탕·중복 감지 목록, 날짜별 관련도 상위 3, 정답지 대조)
//   grading.csv   귀하가 채점할 시트 (관련도 표본, 재탕·중복 표시 항목)
//
// 한계: 로그에는 헤드라인·카테고리만 있고 요약·출처가 없어 실제 운영보다 정보가 적다.
//       결과는 "하한선"으로 해석한다.

import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { runShadowJudgments, DUP_THRESHOLD, REPEAT_THRESHOLD } from "../src/judge.mjs";

const IN = process.argv[2] || "backtest/days.json";
const OUT_DIR = process.argv[3] || "backtest";
const KEEP_DAYS = 14;
const SAMPLE_RELEVANCE = Number(process.env.BACKTEST_SAMPLE || 60);

// 손으로 확인해 둔 정답 사례 (2026-09-10 ~ 09-19 로그 분석). substring으로 매칭한다.
// repeat: 그 날짜의 해당 항목이 이전 브리핑의 재탕 → 표시되어야 함
// dup:    그 날짜의 두 항목이 같은 사건 → 중복 쌍으로 표시되어야 함
const KNOWN_CASES = [
  { kind: "repeat", date: "2026-09-11", includes: "IRON", note: "09-10 XPENG IRON 공개의 재탕" },
  { kind: "repeat", date: "2026-09-13", includes: "로봇 손", note: "09-12 HD현대 로봇 손 투자의 재탕" },
  { kind: "repeat", date: "2026-09-14", includes: "속도 늦출", note: "09-13 앤트로픽 CEO 발언의 재탕" },
  { kind: "repeat", date: "2026-09-15", includes: "감속론", note: "09-14 속도 조절론의 재탕" },
  { kind: "repeat", date: "2026-09-15", includes: "피닉스", note: "09-13 메타 피닉스 유출의 재탕" },
  { kind: "repeat", date: "2026-09-16", includes: "속도 조절", note: "09-15 속도 조절론의 재탕" },
  { kind: "repeat", date: "2026-09-16", includes: "피닉스", note: "09-15 피닉스의 재탕" },
  { kind: "repeat", date: "2026-09-18", includes: "Gen 7", note: "09-16 유니버설로봇 Gen 7의 재탕" },
  { kind: "repeat", date: "2026-09-19", includes: "로만 우주 망원경", note: "09-18 로만 망원경 수명 연장의 재탕" },
  { kind: "dup", date: "2026-09-14", a: "트럼프", b: "개발 속도 늦출", note: "속도 조절론 찬반 (같은 논쟁)" },
  { kind: "dup", date: "2026-09-14", a: "개발 속도 늦출", b: "서버 품귀", note: "속도 조절론 관련 (경계 사례)" },
  { kind: "dup", date: "2026-09-15", a: "감속론", b: "CEOs", note: "AI 감속론 두 건" },
  { kind: "dup", date: "2026-09-15", a: "감속론", b: "자율실험실", note: "LG AI 연구원 두 건 (다른 사건일 수 있음)" },
];

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY 환경변수가 없습니다");
  const { days } = JSON.parse(readFileSync(IN, "utf8"));
  if (!Array.isArray(days) || days.length === 0) throw new Error(`${IN}에 days가 없습니다`);
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  console.log(`[backtest] ${days.length}일치 (${days[0].date} ~ ${days[days.length - 1].date}), 이력 창 ${KEEP_DAYS}일`);

  const results = [];
  const usage = { requests: 0, input_tokens: 0 };
  const started = Date.now();

  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    const cutoff = new Date(day.date); cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    const previous = days
      .slice(0, d)
      .filter((p) => new Date(p.date) > cutoff)
      .flatMap((p) => p.items.map((it) => ({ date: p.date, headline: it.headline })));
    const items = day.items.map((it) => ({ category: it.category, headline: it.headline }));
    try {
      const rep = await runShadowJudgments(items, previous);
      usage.requests += rep.usage.requests;
      usage.input_tokens += rep.usage.input_tokens;
      results.push({ date: day.date, run_id: day.run_id, previous_headlines: previous.length, report: rep });
      const flagged = rep.items.filter((j) => j.repeat?.flagged).length;
      console.log(`[backtest] ${day.date}: ${items.length}건, 이전 ${previous.length}건, 재탕 표시 ${flagged}, 중복 쌍 ${rep.duplicates.length}, 카테고리 변경 ${rep.items.filter((j) => j.category_judged.changed).length}, ${rep.usage.requests}요청`);
    } catch (e) {
      console.error(`[backtest] ${day.date} 실패: ${e.message}`);
      results.push({ date: day.date, run_id: day.run_id, error: e.message });
    }
    // 하루당 최대 21요청이 병렬로 나가므로, 분당 요청 한도(공개 자료 기준 1,200 RPM)를 넘지 않게 잠깐 쉰다
    if (d < days.length - 1) await new Promise((r) => setTimeout(r, 1000));
  }
  const elapsed = (Date.now() - started) / 1000;

  // ── 집계 ──
  const ok = results.filter((r) => r.report);
  const allItems = ok.flatMap((r) => r.report.items.map((j) => ({ date: r.date, ...j })));
  const repeatsFlagged = allItems.filter((j) => j.repeat?.flagged);
  const withHistory = allItems.filter((j) => j.repeat);
  const dupPairs = ok.flatMap((r) => r.report.duplicates.map((p) => ({
    date: r.date, prob: p.prob,
    a: r.report.items[p.i].headline, b: r.report.items[p.j].headline,
  })));
  const catChanges = allItems.filter((j) => j.category_judged.changed);

  // 정답지 대조
  const known = KNOWN_CASES.map((c) => {
    const r = ok.find((x) => x.date === c.date);
    if (!r) return { ...c, result: "해당 날짜 없음" };
    if (c.kind === "repeat") {
      const j = r.report.items.find((x) => x.headline.includes(c.includes));
      if (!j) return { ...c, result: "항목 못 찾음" };
      if (!j.repeat) return { ...c, result: "이력 없음", prob: null };
      return { ...c, prob: j.repeat.prob, result: j.repeat.flagged ? "감지 ✓" : "놓침 ✗" };
    }
    const ia = r.report.items.findIndex((x) => x.headline.includes(c.a));
    const ib = r.report.items.findIndex((x) => x.headline.includes(c.b));
    if (ia < 0 || ib < 0) return { ...c, result: "항목 못 찾음" };
    const [i, j] = ia < ib ? [ia, ib] : [ib, ia];
    const p = r.report.duplicate_pairs_all.find((x) => x.i === i && x.j === j);
    return { ...c, prob: p?.prob ?? null, result: p && p.prob >= DUP_THRESHOLD ? "감지 ✓" : "놓침 ✗" };
  });

  // ── summary.md ──
  const L = [];
  L.push(`# Jev 백테스트 요약`, "");
  L.push(`- 기간: ${ok[0]?.date} ~ ${ok[ok.length - 1]?.date} (${ok.length}일, 실패 ${results.length - ok.length}일)`);
  L.push(`- 항목 ${allItems.length}건, 요청 ${usage.requests}회, 입력 ${usage.input_tokens.toLocaleString()} 토큰, ${elapsed.toFixed(0)}초`);
  L.push(`- 모델 ${ok[0]?.report.model}, 독자 프로필 ${ok[0]?.report.reader_profile_source}, 임계값 재탕 ${REPEAT_THRESHOLD} / 중복 ${DUP_THRESHOLD}`);
  L.push(`- 재탕 표시: ${repeatsFlagged.length} / ${withHistory.length}건 (${withHistory.length ? (100 * repeatsFlagged.length / withHistory.length).toFixed(1) : 0}%)`);
  L.push(`- 같은 날 중복 쌍: ${dupPairs.length}쌍, 카테고리 변경 제안: ${catChanges.length}건`, "");

  L.push(`## 정답지 대조 (손으로 확인한 ${KNOWN_CASES.length}건)`, "");
  L.push(`| 종류 | 날짜 | 사례 | 확률 | 결과 |`, `|---|---|---|---|---|`);
  for (const k of known) L.push(`| ${k.kind} | ${k.date} | ${k.note} | ${k.prob == null ? "-" : k.prob.toFixed(2)} | ${k.result} |`);
  const hit = known.filter((k) => k.result === "감지 ✓").length;
  const judged = known.filter((k) => k.result.startsWith("감지") || k.result.startsWith("놓침")).length;
  L.push("", `감지 ${hit} / 판정 가능 ${judged}`, "");

  L.push(`## 재탕으로 표시된 항목 (확률 ≥ ${REPEAT_THRESHOLD})`, "");
  for (const j of repeatsFlagged) L.push(`- ${j.date} ${j.repeat.prob.toFixed(2)} [${j.category}] ${j.headline}`);
  if (!repeatsFlagged.length) L.push("(없음)");
  L.push("", `## 같은 날 중복 쌍 (확률 ≥ ${DUP_THRESHOLD})`, "");
  for (const p of dupPairs) L.push(`- ${p.date} ${p.prob.toFixed(2)}: ${p.a} ↔ ${p.b}`);
  if (!dupPairs.length) L.push("(없음)");
  L.push("", `## 카테고리 변경 제안`, "");
  for (const j of catChanges) L.push(`- ${j.date} ${j.category}→${j.category_judged.choice} (conf ${j.category_judged.confidence.toFixed(2)}) ${j.headline}`);
  if (!catChanges.length) L.push("(없음)");
  L.push("", `## 날짜별 관련도 상위 3 (점수 0~3)`, "");
  for (const r of ok) {
    const top = [...r.report.items].sort((a, b) => b.relevance.score - a.relevance.score).slice(0, 3);
    L.push(`- **${r.date}**: ` + top.map((j) => `${j.relevance.score.toFixed(2)} ${j.headline}`).join(" · "));
  }

  // 분포 통계: 판정이 얼마나 확신에 차 있는지(보정), 카테고리별 관련도 경향, 전체 상·하위
  L.push("", `## 재탕 확률 분포 (이력이 있는 ${withHistory.length}건)`, "");
  const bins = Array(10).fill(0);
  for (const j of withHistory) bins[Math.min(9, Math.floor(j.repeat.prob * 10))]++;
  L.push(`| 구간 | 건수 |`, `|---|---|`);
  bins.forEach((n, i) => L.push(`| ${(i / 10).toFixed(1)}~${((i + 1) / 10).toFixed(1)} | ${n} |`));
  const gray = withHistory.filter((j) => j.repeat.prob >= 0.3 && j.repeat.prob < 0.7).length;
  L.push("", `회색지대(0.3~0.7): ${gray}건 (${(100 * gray / Math.max(1, withHistory.length)).toFixed(1)}%)`);

  L.push("", `## 카테고리별 관련도 평균`, "");
  L.push(`| 카테고리 | 건수 | 평균 점수 | 평균 confidence |`, `|---|---|---|---|`);
  const byCat = new Map();
  for (const j of allItems) {
    const b = byCat.get(j.category) || { n: 0, s: 0, c: 0 };
    b.n++; b.s += j.relevance.score; b.c += j.relevance.confidence; byCat.set(j.category, b);
  }
  for (const [k, b] of byCat) L.push(`| ${k} | ${b.n} | ${(b.s / b.n).toFixed(2)} | ${(b.c / b.n).toFixed(2)} |`);

  const byScore = [...allItems].sort((a, b) => b.relevance.score - a.relevance.score);
  L.push("", `## 관련도 전체 상위 15`, "");
  for (const j of byScore.slice(0, 15)) L.push(`- ${j.date} ${j.relevance.score.toFixed(2)} [${j.category}] ${j.headline}`);
  L.push("", `## 관련도 전체 하위 10`, "");
  for (const j of byScore.slice(-10).reverse()) L.push(`- ${j.date} ${j.relevance.score.toFixed(2)} [${j.category}] ${j.headline}`);
  const summary = L.join("\n") + "\n";

  // ── grading.csv ──
  const rnd = seededRandom(20260919);
  const sample = [...allItems].sort(() => rnd() - 0.5).slice(0, SAMPLE_RELEVANCE)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const rows = [["section", "date", "headline", "headline_b", "jev_value", "your_answer", "note"]];
  for (const j of sample) rows.push(["relevance(0-3)", j.date, j.headline, "", j.relevance.score.toFixed(2), "", ""]);
  for (const j of repeatsFlagged) rows.push(["repeat(Y/N)", j.date, j.headline, "", j.repeat.prob.toFixed(2), "", ""]);
  for (const p of dupPairs) rows.push(["same_event(Y/N)", p.date, p.a, p.b, p.prob.toFixed(2), "", ""]);
  const csv = "﻿" + rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/results.json`, JSON.stringify({ generated_at: new Date().toISOString(), usage, known, results }, null, 2));
  await writeFile(`${OUT_DIR}/summary.md`, summary);
  await writeFile(`${OUT_DIR}/grading.csv`, csv);

  // 아티팩트를 못 받는 환경에서도 볼 수 있게 요약 전체를 로그에 남긴다 (수백 줄 수준)
  console.log("");
  console.log(summary);
  console.log(`[backtest] 저장: ${OUT_DIR}/results.json, summary.md, grading.csv (채점 행 ${rows.length - 1}개)`);
}

main().catch((e) => { console.error("[backtest] 실패:", e.message); process.exit(1); });
