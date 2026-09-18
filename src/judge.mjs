// src/judge.mjs
// TypeSafe(Jev) 섀도 판정: 수집된 뉴스에 대해 코드로는 못 하는 "의미 판단"을 묻고
// 결과를 리포트로만 남긴다. 이 단계는 메일 내용을 바꾸지 않는다(섀도 모드).
//
// 판정 4종
//   1. 같은 날 중복   : 후보 쌍마다 "같은 사건인가" (Noul)      → 한 요청에 45개 질문
//   2. 전날 재탕      : "이전 브리핑에 이미 나온 사건인가" (Noul) → 항목별 요청
//   3. 독자 관련도    : 독자 프로필 기준 중요도 0~3 (Score)      → 항목별 요청
//   4. 카테고리 재분류: AI/XR/우주/로봇 중 택1 (Choice)          → 3과 같은 요청
//
// 설계 근거(docs.typesafe.ai 및 SKILL.md):
//   - 서로 독립인 질문은 같은 state에 묶어 한 요청으로 보내면 병렬 처리된다.
//   - 질문에 불필요한 state 필드가 있으면 정확도가 떨어진다 → 재탕 판정만 이전 헤드라인을 state에 넣는다.
//   - 날짜 비교는 모델이 약하다 → 날짜는 참고 표시일 뿐 판정 기준으로 쓰지 않는다.
//   - 질문은 문자 그대로 읽는다 → 지시문에 "같은 사건"의 정의와 반례를 명시한다.

import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";

export function isJudgeEnabled() {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

// 리포트에서 "중복/재탕으로 표시"하는 확률 기준 (판정 자체는 확률 그대로 저장)
export const DUP_THRESHOLD = Number(process.env.DUP_THRESHOLD || 0.7);
export const REPEAT_THRESHOLD = Number(process.env.REPEAT_THRESHOLD || 0.7);

const CATEGORIES = ["AI", "XR", "우주", "로봇"];

const READER_PROFILE = {
  role: "A professional who follows global technology news",
  education: "(redacted)",
  briefing_purpose: "Daily global tech news in AI, XR, space industry, and robotics",
  strong_interests: [
    "industrial applications",
    "physical AI, industrial robots, humanoids in factories, automation of manufacturing",
    "technology strategy, corporate R&D, industry policy, and major investments or deals",
  ],
  weak_interests: ["consumer gadget rumors", "entertainment or gaming-only news", "minor product updates"],
};

const SAME_EVENT_RULE = {
  same_event: "Both describe the same concrete occurrence: the same announcement, launch, deal, funding round, report, incident, or statement, even if the wording, emphasis, or source differs.",
  not_same_event: "They merely share a topic, company, technology, or theme; or one is a genuinely new development (a new date, a new deal, a follow-up reaction) that the other does not contain.",
};

function candidateView(it) {
  return { category: it.category, headline: it.headline, summary: it.summary, source: it.source };
}

// 1. 같은 날 중복: 한 요청, 쌍별 Noul
async function judgeDuplicates(client, items) {
  if (items.length < 2) return { pairs: [], usage: null };
  const candidates = items.map((it, index) => ({ index, headline: it.headline, summary: it.summary }));
  const questions = {};
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      questions[`same_${i}_${j}`] = noul(
        {
          question: `Do \`candidates[${i}]\` and \`candidates[${j}]\` report the same underlying news event?`,
          rule: SAME_EVENT_RULE,
        },
        { true: SAME_EVENT_RULE.same_event, false: SAME_EVENT_RULE.not_same_event }
      );
    }
  }
  const res = await client.systemOne({ state: { candidates }, questions });
  const pairs = [];
  for (const [key, ans] of Object.entries(res.answers)) {
    const [, i, j] = key.split("_").map(Number);
    pairs.push({ i, j, prob: ans.noul });
  }
  return { pairs, usage: res.usage, model: res.model };
}

// 3+4. 독자 관련도 + 카테고리: 항목별 한 요청 (state는 후보 하나만)
async function judgeItem(client, it) {
  const res = await client.systemOne({
    state: { candidate: candidateView(it), reader: READER_PROFILE },
    questions: {
      relevance: score(
        "How important is the news in `candidate` for the reader described in `reader`? Judge by the substance of the event, not by the wording of the headline.",
        [
          "Level 0: Not useful to this reader. A consumer gadget rumor, entertainment, a minor update, or generic commentary with no concrete event.",
          "Level 1: General tech news worth a glance. A real event in AI, XR, space, or robotics, but no plausible link to heavy industry, manufacturing, or technology strategy.",
          "Level 2: Significant development the reader should know. A major model, product, launch, policy, or deal in AI, XR, space, or robotics with plausible implications for manufacturing, industrial automation, or corporate technology strategy.",
          "Level 3: Directly relevant. Concerns the reader's industry head-on, or a strategic shift large enough that the reader's company would need to respond.",
        ]
      ),
      category: choice(
        "Which section of the briefing does `candidate` belong to? Choose by the main subject of the event, not by which technologies are mentioned in passing.",
        {
          AI: "AI models, AI companies, AI policy and regulation, AI chips and infrastructure, AI safety. Includes AI used in software or science when the AI itself is the story.",
          XR: "AR, VR, MR headsets and smart glasses, spatial computing, and XR platforms or content.",
          "우주": "Space industry: launches, satellites, rockets, space agencies, space missions, space policy, and space-based systems, even when AI is used on them.",
          "로봇": "Robotics: humanoids, industrial and service robots, robot makers, robot factories, and physical AI deployed in robots.",
        }
      ),
    },
  });
  return { relevance: res.answers.relevance, category: res.answers.category, usage: res.usage, model: res.model };
}

// 2. 전날 재탕: 항목별 한 요청 (state에 이전 헤드라인 포함)
async function judgeRepeat(client, it, previous) {
  if (previous.length === 0) return null;
  const res = await client.systemOne({
    state: { candidate: candidateView(it), previous_headlines: previous },
    questions: {
      repeated: noul(
        {
          question: "Was the event in `candidate` already covered by any entry in `previous_headlines`, which are headlines this reader received in earlier daily briefings?",
          rule: SAME_EVENT_RULE,
          note: "The dates are for reference only. Judge by whether the event itself is the same.",
        },
        { true: "Yes: the same event as at least one previous headline.", false: "No: a new event, or only the same topic or company as before." }
      ),
    },
  });
  return { prob: res.answers.repeated.noul, usage: res.usage, model: res.model };
}

// 전체 실행. 실패는 호출 측에서 잡아 메일 발송에 영향이 없게 한다.
export async function runShadowJudgments(items, previous, { fetch: fetchImpl } = {}) {
  const client = new TypeSafeClient({
    timeout: 15000,
    logLevel: "warn",
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const started = Date.now();

  const [dup, perItem, repeats] = await Promise.all([
    judgeDuplicates(client, items),
    Promise.all(items.map((it) => judgeItem(client, it))),
    Promise.all(items.map((it) => judgeRepeat(client, it, previous))),
  ]);

  const usage = { requests: 0, input_tokens: 0, output_tokens: 0 };
  const addUsage = (u) => {
    if (!u) return;
    usage.requests += 1;
    usage.input_tokens += u.input_tokens || 0;
    usage.output_tokens += u.output_tokens || 0;
  };
  addUsage(dup.usage);
  perItem.forEach((r) => addUsage(r.usage));
  repeats.forEach((r) => addUsage(r?.usage));

  const judged = items.map((it, index) => ({
    index,
    position: index + 1, // 메일에 실린 순서
    category: it.category,
    headline: it.headline,
    source: it.source,
    url: it.url,
    linkStatus: it.linkStatus,
    gemini_importance: it.importance,
    relevance: {
      score: perItem[index].relevance.score,
      confidence: perItem[index].relevance.confidence,
      probabilities: perItem[index].relevance.probabilities,
    },
    category_judged: {
      choice: perItem[index].category.choice,
      confidence: perItem[index].category.confidence,
      changed: perItem[index].category.choice !== it.category,
    },
    repeat: repeats[index] ? { prob: repeats[index].prob, flagged: repeats[index].prob >= REPEAT_THRESHOLD } : null,
  }));

  const duplicates = dup.pairs
    .filter((p) => p.prob >= DUP_THRESHOLD)
    .sort((a, b) => b.prob - a.prob);

  // 제안 순서: 중복 쌍의 뒤쪽(j)과 재탕 항목을 뺀 뒤 관련도 점수 내림차순 (동점이면 원래 순서)
  const dropped = new Set();
  for (const p of duplicates) if (!dropped.has(p.i)) dropped.add(p.j);
  for (const j of judged) if (j.repeat?.flagged) dropped.add(j.index);
  const proposed = judged
    .filter((j) => !dropped.has(j.index))
    .sort((a, b) => b.relevance.score - a.relevance.score || a.index - b.index)
    .map((j) => j.index);

  return {
    mode: "shadow",
    model: dup.model || perItem[0]?.model || null,
    thresholds: { duplicate: DUP_THRESHOLD, repeat: REPEAT_THRESHOLD },
    elapsed_ms: Date.now() - started,
    usage,
    previous_headlines: previous.length,
    items: judged,
    duplicate_pairs_all: dup.pairs,
    duplicates,
    dropped: [...dropped].sort((a, b) => a - b),
    proposed_order: proposed,
  };
}

// 콘솔용 요약 (Actions 로그에서 바로 읽을 수 있게)
export function formatShadowReport(rep) {
  const lines = [];
  lines.push(
    `[shadow] 모델 ${rep.model}, 요청 ${rep.usage.requests}회, 입력 ${rep.usage.input_tokens} 토큰, ` +
    `${(rep.elapsed_ms / 1000).toFixed(1)}초, 이전 헤드라인 ${rep.previous_headlines}개`
  );
  lines.push("[shadow] 항목별 판정 (관련도 0~3 / 카테고리 / 재탕확률)");
  for (const j of rep.items) {
    const cat = j.category_judged.changed ? `${j.category}→${j.category_judged.choice}` : j.category;
    const rep_ = j.repeat ? `재탕 ${j.repeat.prob.toFixed(2)}${j.repeat.flagged ? "⚠️" : ""}` : "재탕 -";
    lines.push(
      `  ${String(j.position).padStart(2, "0")}. 관련도 ${j.relevance.score.toFixed(2)} ` +
      `(conf ${j.relevance.confidence.toFixed(2)}) [${cat}] ${rep_} | ${j.headline}`
    );
  }
  if (rep.duplicates.length) {
    lines.push(`[shadow] 같은 날 중복 의심 (확률 ≥ ${rep.thresholds.duplicate}):`);
    for (const p of rep.duplicates) {
      lines.push(`  ${p.prob.toFixed(2)}: #${p.i + 1} ↔ #${p.j + 1}`);
    }
  } else {
    lines.push("[shadow] 같은 날 중복 의심 없음");
  }
  lines.push(
    `[shadow] 제안 순서: ${rep.proposed_order.map((i) => `#${i + 1}`).join(" ")}` +
    (rep.dropped.length ? `  (제외: ${rep.dropped.map((i) => `#${i + 1}`).join(" ")})` : "")
  );
  return lines.join("\n");
}
