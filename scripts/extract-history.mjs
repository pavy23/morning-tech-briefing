// scripts/extract-history.mjs
// 과거 GitHub Actions 실행 로그(보관 90일)에서 실제 발송된 브리핑 헤드라인을 추출해
// backtest/days.json 으로 저장한다. Actions 러너에 기본 설치된 gh CLI를 사용한다.
//
// 출력 형식: { days: [ { date: "2026-09-19", run_id, items: [ { category, headline } ] } ] }
// 같은 날짜에 발송이 여러 번이면(수동 테스트) 가장 늦은 실행을 채택한다.

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const OUT = process.argv[2] || "backtest/days.json";
const WORKFLOW = process.env.BACKTEST_WORKFLOW || "daily.yml";
const LIMIT = process.env.BACKTEST_RUN_LIMIT || "400";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// 로그 한 실행분에서 날짜·발송 여부·헤드라인 목록을 뽑는다 (export: 단위 테스트용)
export function parseRunLog(text, createdAt) {
  const sent = /발송 완료/.test(text);
  let date = null;
  const m = text.match(/시각\(KST\): (\d{4})\. (\d{1,2})\. (\d{1,2})\./);
  if (m) date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  else if (createdAt) date = new Date(createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

  const items = [];
  const seen = new Set();
  for (const line of text.split("\n")) {
    // gh run view --log 는 "job\tstep\ttimestamp text" 형태로 접두사가 붙는다 → 뒤쪽만 본다
    const mm = line.match(/(?:^|\s)(\d{2})\. \[([^\]]+)\] (.+?)\s*$/);
    if (!mm) continue;
    const idx = Number(mm[1]);
    if (seen.has(idx)) continue; // 섀도 블록 등 뒤에 오는 동일 번호는 무시
    seen.add(idx);
    const headline = mm[3].replace(/ \(직접URL\)$/, "").replace(/ ⚠️검색폴백$/, "").trim();
    items.push({ category: mm[2].trim(), headline });
  }
  return { date, sent, items };
}

async function main() {
  const runs = JSON.parse(gh([
    "run", "list", "--workflow", WORKFLOW, "--limit", LIMIT,
    "--json", "databaseId,createdAt,event,conclusion,status",
  ]));
  console.log(`[extract] 실행 목록 ${runs.length}건`);

  const byDate = new Map();
  let parsed = 0, skipped = 0;
  for (const run of runs) {
    if (run.status !== "completed" || run.conclusion !== "success") { skipped++; continue; }
    let text;
    try {
      text = gh(["run", "view", String(run.databaseId), "--log"]);
    } catch (e) {
      console.error(`[extract] run ${run.databaseId} 로그 읽기 실패: ${String(e.message).slice(0, 120)}`);
      skipped++;
      continue;
    }
    const r = parseRunLog(text, run.createdAt);
    if (!r.sent || !r.date || r.items.length === 0) { skipped++; continue; }
    parsed++;
    const prev = byDate.get(r.date);
    if (!prev || new Date(run.createdAt) > new Date(prev.createdAt)) {
      byDate.set(r.date, { date: r.date, run_id: run.databaseId, createdAt: run.createdAt, items: r.items });
    }
  }

  const days = [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(({ createdAt, ...d }) => d);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ extracted_at: new Date().toISOString(), days }, null, 2));
  console.log(`[extract] 발송 로그 ${parsed}건 파싱, ${skipped}건 제외 → ${days.length}일치 저장: ${OUT}`);
  if (days.length) console.log(`[extract] 기간: ${days[0].date} ~ ${days[days.length - 1].date}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
