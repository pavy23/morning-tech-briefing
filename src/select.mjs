// src/select.mjs
// Jev 판정 결과로 후보를 실제 선별한다: 재탕 제거 → 같은 날 중복 제거 → 카테고리 배분대로 채움.
// 순서는 입력 순서(Gemini 중요도 → 원래 순)를 유지한다. 관련도 정렬은 아직 적용하지 않는다
// (백테스트로 재탕·중복은 검증됐고, 관련도는 독자 채점 뒤에 켠다).

import { config, quotasFor } from "./config.mjs";

// items: 후보 배열 (report.items와 같은 인덱스), report: runShadowJudgments 결과
export function selectItems(items, report, {
  total = config.total,
  repeatThreshold = report?.thresholds?.repeat ?? 0.7,
  dupThreshold = report?.thresholds?.duplicate ?? 0.7,
} = {}) {
  const n = items.length;
  const removed = []; // { index, reason: "offtopic" | "generic" | "repeat" | "duplicate", prob, of? }
  const gone = new Set();

  // 1) 주제 이탈("해당 없음" 확률), 일반론(구체적 사건 확률이 낮음), 재탕(이전 브리핑에서 이미 다룬 사건)
  for (const j of report?.items ?? []) {
    if (j.offtopic?.flagged) {
      gone.add(j.index);
      removed.push({ index: j.index, reason: "offtopic", prob: j.offtopic.prob });
    } else if (j.concrete?.flagged) {
      gone.add(j.index);
      removed.push({ index: j.index, reason: "generic", prob: j.concrete.prob });
    } else if (j.repeat && j.repeat.prob >= repeatThreshold) {
      gone.add(j.index);
      removed.push({ index: j.index, reason: "repeat", prob: j.repeat.prob });
    }
  }

  // 2) 같은 날 중복: 확률 높은 쌍부터, 둘 다 살아 있으면 뒤쪽(i<j이므로 j = 중요도가 낮거나 나중 순서)을 뺀다
  const pairs = [...(report?.duplicate_pairs_all ?? [])]
    .filter((p) => p.prob >= dupThreshold)
    .sort((a, b) => b.prob - a.prob || a.i - b.i);
  for (const p of pairs) {
    if (gone.has(p.i) || gone.has(p.j)) continue;
    gone.add(p.j);
    removed.push({ index: p.j, reason: "duplicate", prob: p.prob, of: p.i });
  }

  // 3) 카테고리 배분대로 채우고, 모자라면 남은 후보로 보충 (모두 입력 순서 유지)
  const alive = [];
  for (let i = 0; i < n; i++) if (!gone.has(i)) alive.push(i);
  const chosen = new Set();
  for (const q of quotasFor(total)) {
    let need = q.count;
    for (const i of alive) {
      if (need <= 0) break;
      if (!chosen.has(i) && items[i].category === q.key) { chosen.add(i); need--; }
    }
  }
  for (const i of alive) {
    if (chosen.size >= total) break;
    chosen.add(i);
  }
  const selectedIdx = [...chosen].sort((a, b) => a - b).slice(0, total);

  // 선별 근거를 항목에 남긴다 (리포트·로그용). 후보 인덱스는 0부터.
  const selected = selectedIdx.map((i) => ({ ...items[i], candidateIndex: i }));
  const byCat = {};
  for (const it of selected) byCat[it.category] = (byCat[it.category] || 0) + 1;

  return {
    selected,
    removed: removed.sort((a, b) => a.index - b.index),
    unused: alive.filter((i) => !chosen.has(i)), // 살아남았지만 자리가 없어 안 실린 후보
    counts: byCat,
    candidates: n,
  };
}

// 콘솔 한 줄 요약 + 제거 목록
export function formatSelection(sel, items) {
  const lines = [];
  const LABEL = {
    offtopic: (r) => `주제 이탈(해당 없음 ${r.prob.toFixed(2)})`,
    generic: (r) => `일반론(사건성 ${r.prob.toFixed(2)})`,
    repeat: (r) => `재탕 ${r.prob.toFixed(2)}`,
    duplicate: (r) => `중복(#${r.of + 1}과 같은 사건 ${r.prob.toFixed(2)})`,
  };
  const reasons = sel.removed.map((r) => `#${r.index + 1} ${LABEL[r.reason](r)} "${items[r.index].headline}"`);
  const counts = Object.entries(sel.counts).map(([k, v]) => `${k} ${v}`).join(", ");
  lines.push(`[select] 후보 ${sel.candidates}건 → 제거 ${sel.removed.length}건 → ${sel.selected.length}건 선별 (${counts}), 미사용 ${sel.unused.length}건`);
  for (const r of reasons) lines.push(`  - 제거: ${r}`);
  return lines.join("\n");
}
