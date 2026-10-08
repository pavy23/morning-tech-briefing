// src/claude-news.mjs
// Claude + 웹 검색 도구로 뉴스 후보를 모은다. 재시도·가드·링크 처리는 fetch-news.mjs가 맡는다.
//
// Gemini 그라운딩과 달리 검색 결과에 발행처의 실제 기사 주소와 page_age(페이지 갱신 시점)가
// 그대로 오므로, 모델이 쓴 URL을 검색 결과 목록과 대조해 "검색으로 확인된 기사"인지 코드로 판별한다.

import Anthropic from "@anthropic-ai/sdk";
import { config, quotasFor } from "./config.mjs";
import { recordUsage } from "./cost.mjs";

export function isClaudeModel(model) {
  return /^claude-/i.test(String(model || ""));
}

// 기본 검색(web_search_20250305)을 쓴다. 검색 결과를 코드로 거르는 동적 필터링(web_search_20260209)은
// 토큰은 적게 들지만, 2026-10-08 실측(Sonnet 5.5, 4회)에서 검색 코드가 자주 오류를 내 검색 한도만
// 소진하고 기사를 10~12건밖에 못 모았다(분야별 분할 호출에선 XR·로봇 0건).
// 기본 검색 + 프롬프트 캐싱은 같은 날 16건(분야 고르게), 1회 약 $0.83이었다. NEWS_SEARCH_TOOL로 바꿀 수 있다.
export function webSearchToolFor() {
  return String(process.env.NEWS_SEARCH_TOOL || "").trim() || "web_search_20250305";
}

function intEnv(name, fallback) {
  const raw = String(process.env[name] ?? "").trim();
  return raw !== "" && Number.isFinite(Number(raw)) ? Math.max(1, Math.floor(Number(raw))) : fallback;
}

// 검색 한 번에 $0.01. 한도를 넘긴 검색은 실패로 돌아오므로 프롬프트에도 같은 숫자를 알려 준다.
export const searchBudget = () => intEnv("NEWS_MAX_SEARCHES", 25);
const effortLevel = () => String(process.env.NEWS_EFFORT || "medium").trim().toLowerCase();
// 서버 쪽 검색 루프는 10회 반복마다 pause_turn으로 멈춘다. 그대로 돌려보내 이어 가게 하는 횟수 상한.
const MAX_CONTINUATIONS = 5;

export function buildClaudePrompt(cfg = config, want = cfg.total, budget = searchBudget()) {
  const quotas = quotasFor(want, cfg);
  const allowed = cfg.categories.map((c) => c.key).join(", ");
  const scope = cfg.categories
    .map((c) => `- ${c.key} ${quotas.find((q) => q.key === c.key)?.count ?? 0}건${c.description ? `: ${c.description}` : ""}`)
    .join("\n");
  return `당신은 글로벌 테크 뉴스 에디터입니다.
웹 검색으로 ${cfg.searchScope} 최신 글로벌 주요 뉴스 ${want}건을 찾아, 각 뉴스를 아래 형식의 항목으로 정리하세요.

분야와 권장 건수:
${scope}

### 1
카테고리: ${cfg.categories[0].key}
헤드라인: 한국어 헤드라인 (60자 이내)
요약: 핵심 내용 요약 (100~150자 한국어). 검색으로 확인한 사실만 쓰고, 기사에 있는 구체적 수치·고유명사를 포함하세요.
출처: 출처 언론사명
URL: 검색 결과에 나온 그 기사의 주소 그대로
검색어: 원문 기사를 다시 찾을 수 있는 키워드 3~4개. 원문 기사 제목에 나오는 회사·제품·인물 같은 고유명사 위주로, 원문 기사의 언어 그대로 씁니다 (영어 기사면 영어).
중요도: high

규칙:
- 게시 시점: 오늘(KST) 기준 최근 24시간 이내 기사를 우선하고, 모자라면 48시간 이내 기사로 채웁니다. 그보다 오래됐거나 게시 시점을 확인할 수 없는 기사는 넣지 않습니다.
- URL은 검색 결과에 실제로 나온 개별 기사 주소만 씁니다. 홈페이지·섹션 페이지·추측한 주소는 쓰지 않습니다.
- 출처는 처음 보도한 언론사나 회사·기관의 공식 발표를 우선하고, 다른 기사를 옮겨 실은 집계·요약 사이트는 피합니다.
- 분야별 권장 건수를 채우는 것을 우선합니다. 한 분야의 기사가 모자라면 그 분야를 다른 검색어(회사·제품 이름, 영어 검색어 등)로 다시 검색합니다.
- 웹 검색은 최대 ${budget}회까지 쓸 수 있고, 한도를 넘기면 그 검색은 실패합니다. 분야마다 고르게 나눠 쓰세요.
- 카테고리는 반드시 ${allowed} 중 하나, 중요도는 high 또는 medium
- 각 항목은 "### 번호"로 시작하고, 위 일곱 줄만 씁니다. 머리말·맺음말·표는 쓰지 않습니다.
- 서로 다른 뉴스여야 하며, 같은 사건을 두 번 넣지 않습니다.`;
}

// 인증: ANTHROPIC_API_KEY(워크스페이스 전용 키 권장). 여러 워크스페이스용 개인 키라면
// ANTHROPIC_WORKSPACE_ID도 함께 주면 요청마다 워크스페이스 헤더를 붙인다.
// 키가 없으면 SDK가 Workload Identity Federation 환경변수(ANTHROPIC_FEDERATION_RULE_ID 등)를 찾는다.
export function hasClaudeCredentials(env = process.env) {
  const has = (k) => String(env[k] ?? "").trim() !== "";
  return has("ANTHROPIC_API_KEY") || has("ANTHROPIC_AUTH_TOKEN") || has("ANTHROPIC_PROFILE") ||
    (has("ANTHROPIC_FEDERATION_RULE_ID") && has("ANTHROPIC_ORGANIZATION_ID"));
}

let client = null;
function claudeClient() {
  if (client) return client;
  if (!hasClaudeCredentials()) {
    const e = new Error("Anthropic 인증 정보가 없습니다 (Secrets에 ANTHROPIC_API_KEY를 등록하세요)");
    e.status = 401;
    throw e;
  }
  const workspace = String(process.env.ANTHROPIC_WORKSPACE_ID || "").trim();
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  client = new Anthropic({
    // 과부하(529)·한도(429)는 fetch-news.mjs의 재시도 루프가 20~60초씩 기다리며 처리한다
    maxRetries: 1,
    timeout: 10 * 60 * 1000,
    ...(apiKey && workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  return client;
}

// URL 비교용 정규화: 프로토콜·www·끝 슬래시·추적 파라미터를 무시한다.
export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) {
      if (/^(utm_|ref$|fbclid$|gclid$)/i.test(k)) x.searchParams.delete(k);
    }
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase();
  } catch {
    return String(u || "").trim().toLowerCase();
  }
}

// page_age("3 hours ago", "October 7, 2026" 등)를 기준 시각에서 몇 시간 전인지로 바꾼다. 모르면 null.
export function pageAgeHours(pageAge, now = Date.now()) {
  if (!pageAge) return null;
  const m = String(pageAge).match(/(\d+)\s*(minute|min|hour|hr|day|week|month|year)s?\s+ago/i);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u.startsWith("min")) return n / 60;
    if (u.startsWith("h")) return n;
    if (u.startsWith("d")) return n * 24;
    if (u.startsWith("w")) return n * 168;
    if (u.startsWith("mo")) return n * 720;
    return n * 8760;
  }
  if (/yesterday/i.test(pageAge)) return 24;
  const t = Date.parse(pageAge);
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / 3600000);
}

// 응답 블록들을 하나의 텍스트로 잇고(인용 위치 포함), 검색 결과 목록을 모은다.
// 검색 호출 등으로 끊긴 뒤의 텍스트는 새 줄에서 시작하게 해 "### N" 머리를 놓치지 않는다.
export function collectResponse(responses) {
  let text = "";
  const spans = [];
  const results = new Map();
  const queries = [];
  const searchErrors = [];
  for (const res of responses) {
    let gap = true;
    for (const b of res.content || []) {
      if (b.type !== "text") {
        gap = true;
        if (b.type === "server_tool_use" && b.name === "web_search") queries.push(b.input?.query);
        if (b.type === "web_search_tool_result") {
          if (Array.isArray(b.content)) {
            for (const r of b.content) if (r?.url) results.set(normalizeUrl(r.url), r);
          } else if (b.content?.error_code) {
            searchErrors.push(b.content.error_code);
          }
        }
        continue;
      }
      if (gap && text && !text.endsWith("\n")) text += "\n";
      gap = false;
      const start = text.length;
      text += b.text;
      spans.push({ start, end: text.length, citations: (b.citations || []).map((c) => c.url).filter(Boolean) });
    }
  }
  return { text, spans, results, queries, searchErrors };
}

// 각 항목의 URL을 검색 결과와 대조한다.
//  - 모델이 쓴 URL이 검색 결과에 있으면 그 결과로 확인 (sourceVerified)
//  - 없으면 그 항목 문장에 붙은 인용(citations) 중 검색 결과에 있는 주소로 대체
//  - 둘 다 없으면 모델이 쓴 주소를 그대로 두고, 링크 처리 단계에서 접속 확인을 받게 한다
export function verifyAgainstResults(items, collected, now = Date.now()) {
  const { spans, results } = collected;
  for (const it of items) {
    const cited = [...new Set(spans
      .filter((s) => s.end > it._start && s.start < it._end)
      .flatMap((s) => s.citations))];
    let hit = it.url ? results.get(normalizeUrl(it.url)) : null;
    if (!hit) {
      const c = cited.find((u) => results.has(normalizeUrl(u)));
      if (c) hit = results.get(normalizeUrl(c));
    }
    if (hit) {
      it.url = hit.url;
      it.sourceVerified = true;
      it.pageAge = hit.page_age ?? null;
      it.ageHours = pageAgeHours(hit.page_age, now);
    } else {
      it.sourceVerified = false;
    }
  }
}

// usage 합산 (pause_turn으로 이어 받은 응답까지)
function sumUsage(responses) {
  const u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, thinking: 0 };
  for (const r of responses) {
    u.input += r.usage?.input_tokens || 0;
    u.output += r.usage?.output_tokens || 0;
    u.cacheRead += r.usage?.cache_read_input_tokens || 0;
    u.cacheWrite += r.usage?.cache_creation_input_tokens || 0;
    u.searches += r.usage?.server_tool_use?.web_search_requests || 0;
    u.thinking += r.usage?.output_tokens_details?.thinking_tokens || 0;
  }
  return u;
}

// Claude 호출 + 목록 파싱 + 출처 확인. parseList는 fetch-news.mjs의 "### N" 파서를 받는다.
// 반환 형태는 Gemini 경로와 같다: { items, chunkUris, finishReason, format }
export async function fetchClaudeItems(model, want, { todayKst, parseList }) {
  const budget = searchBudget();
  const tool = { type: webSearchToolFor(), name: "web_search", max_uses: budget };
  const messages = [{ role: "user", content: `오늘은 ${todayKst} (KST)입니다.\n\n${buildClaudePrompt(config, want, budget)}` }];
  const responses = [];
  try {
    for (let turn = 0; turn < MAX_CONTINUATIONS; turn++) {
      const msg = await claudeClient().messages
        .stream({
          model,
          max_tokens: 32000,
          messages,
          tools: [tool],
          output_config: { effort: effortLevel() },
          // 자동 캐싱: 검색 루프가 결과 뒤에 캐시 지점을 넣어, 반복마다 다시 읽는 앞부분이 캐시 읽기
          // (Sonnet 5.5 기준 입력 단가의 5%)로 과금된다. 실측 입력 60만 토큰 중 41만이 캐시 읽기.
          cache_control: { type: "ephemeral" },
        })
        .finalMessage();
      responses.push(msg);
      if (msg.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: msg.content });
    }
  } finally {
    // 실패한 시도라도 이미 받은 응답의 사용량은 비용에 넣는다
    if (responses.length) recordUsage({ provider: "anthropic", model, stage: "collect", ...sumUsage(responses) });
  }

  const last = responses[responses.length - 1];
  const usage = sumUsage(responses);
  const collected = collectResponse(responses);
  if (!collected.text.trim()) throw new Error(`Claude 텍스트 응답 없음. stop_reason: ${last?.stop_reason}`);
  const parsed = parseList(collected.text);
  verifyAgainstResults(parsed.items, collected);
  for (const it of parsed.items) {
    delete it._start;
    delete it._end;
  }
  const verified = parsed.items.filter((it) => it.sourceVerified).length;
  const fresh = parsed.items.filter((it) => it.ageHours != null && it.ageHours <= 48).length;
  console.log(
    `[fetch-news] Claude ${model} (${tool.type}, effort ${effortLevel()}): 검색 ${usage.searches}회` +
    `${collected.searchErrors.length ? ` (실패 ${collected.searchErrors.join(",")})` : ""}, 결과 URL ${collected.results.size}개 → ` +
    `항목 ${parsed.items.length}개, 검색 결과로 확인된 주소 ${verified}개, 48시간 이내 ${fresh}개 | ` +
    `토큰 입력 ${usage.input}·출력 ${usage.output}`
  );
  return {
    items: parsed.items,
    chunkUris: [...collected.results.values()].map((r) => r.url),
    finishReason: last?.stop_reason || "unknown",
    format: "list",
  };
}
