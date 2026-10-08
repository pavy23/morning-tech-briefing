// src/fetch-news.mjs
// briefing.config.json에 정의된 주제의 뉴스를 웹 검색으로 수집한다.
// MODEL이 claude-*이면 Claude + 웹 검색 도구(claude-news.mjs), 아니면 Gemini + Google Search grounding.

import { config, categoryKeys, defaultCategory, normalizeCategory, quotasFor } from "./config.mjs";
import { isClaudeModel, hasClaudeCredentials, fetchClaudeItems } from "./claude-news.mjs";
import { recordUsage } from "./cost.mjs";

const MODEL = process.env.MODEL || "claude-sonnet-5-5";
// 기본 모델이 거듭 실패할 때 쓸 백업 모델 (같은 모델이면 폴백 비활성).
// Claude가 기본이면 다른 회사의 Gemini 3.6 Flash로 넘겨 한쪽 API 장애·인증 오류에도 메일이 나가게 하고,
// Gemini가 기본이면 기존처럼 3.5-flash-lite (2.5-flash-lite는 2026-10-16 종료 예정).
const FALLBACK_MODEL = process.env.FALLBACK_MODEL ||
  (isClaudeModel(MODEL) ? "gemini-3.6-flash" : "gemini-3.5-flash-lite");

// 프롬프트는 설정 파일의 주제·카테고리·개수 배분으로 조립한다 (주제 변경 시 코드 수정 불필요).
// want: 요청할 건수. Jev 선별이 켜지면 목표(total)보다 많이 받아 재탕·중복을 뺀 자리를 채운다.
export function buildPrompt(cfg = config, want = cfg.total) {
  const quota = quotasFor(want, cfg).map((q) => `${q.key} ${q.count}개`).join(", ");
  const allowed = cfg.categories.map((c) => `"${c.key}"`).join(", ");
  return `당신은 글로벌 테크 뉴스 에디터입니다.
Google 검색을 사용해 오늘 날짜 기준 최근 24시간 이내의 ${cfg.searchScope} 가장 중요한 글로벌 주요 뉴스를 찾아 아래 JSON 형식으로만 응답하세요.

반드시 아래 JSON 구조로, 코드블록이나 다른 텍스트 없이 순수 JSON만 출력하세요:

{
  "items": [
    {
      "id": 1,
      "category": "${cfg.categories[0].key}",
      "headline": "한국어 헤드라인 (60자 이내)",
      "summary": "핵심 내용 요약 (100~150자 한국어)",
      "source": "출처 언론사명",
      "importance": "high",
      "url": "https://원본기사URL",
      "keywords": "원문 기사를 다시 찾을 핵심 키워드 3~4개"
    }
  ]
}

규칙:
- 총 ${want}개: ${quota} 권장
- category는 반드시 ${allowed} 중 하나
- importance는 "high" 또는 "medium"
- url은 반드시 https://로 시작하는 실제 기사 URL
- keywords는 원문 기사 제목에 나오는 회사·제품·인물 같은 고유명사 위주 3~4개 단어, 원문 기사의 언어 그대로 (영어 기사면 영어)
- summary는 150자 이내, 한국어로 작성
- 순수 JSON만 출력`;
}

// 잘린 JSON도 최대한 복구하는 파서
function parseNewsJSON(raw) {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("JSON 시작 위치를 찾을 수 없습니다");
  const lastBrace = cleaned.lastIndexOf("}");
  if (lastBrace > start) {
    try {
      return JSON.parse(cleaned.slice(start, lastBrace + 1));
    } catch (_) {}
  }
  const itemsStart = cleaned.indexOf('"items"');
  const arrStart = itemsStart !== -1 ? cleaned.indexOf("[", itemsStart) : -1;
  if (arrStart === -1) throw new Error("items 배열을 찾을 수 없습니다");
  const items = [];
  let i = arrStart + 1;
  while (i < cleaned.length) {
    while (i < cleaned.length && cleaned[i] !== "{") i++;
    if (i >= cleaned.length) break;
    const objStart = i;
    let depth = 0, inString = false, escape = false, end = -1;
    for (let j = objStart; j < cleaned.length; j++) {
      const ch = cleaned[j];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end === -1) break;
    try { items.push(JSON.parse(cleaned.slice(objStart, end + 1))); } catch (_) {}
    i = end + 1;
  }
  if (items.length === 0) throw new Error("복구 가능한 뉴스 항목이 없습니다");
  return { items };
}

// ─── 목록 형식 (Gemini 3.x용) ───────────────────────────────────────────
// Gemini 3.x는 JSON 출력을 요구하면(프롬프트 문장으로만 요구해도) Google 검색 그라운딩을
// 조용히 끄고 groundingMetadata를 돌려주지 않는다 (google-gemini/cookbook#1274, 2026-06;
// 이 저장소 실측 2026-09-25: gemini-3.6-flash 6회 모두 chunk 0개).
// 그래서 3.x에는 산문에 가까운 번호 목록으로 받고, 출처 URL은 모델이 쓰게 하지 않고
// groundingSupports(문장 ↔ 출처 chunk 매핑)에서 코드로 붙인다.
export function buildListPrompt(cfg = config, want = cfg.total) {
  const quota = quotasFor(want, cfg).map((q) => `${q.key} ${q.count}개`).join(", ");
  const allowed = cfg.categories.map((c) => c.key).join(", ");
  return `당신은 글로벌 테크 뉴스 에디터입니다.
Google 검색을 사용해 오늘 날짜 기준 최근 24시간 이내의 ${cfg.searchScope} 가장 중요한 글로벌 주요 뉴스 ${want}건을 찾아, 각 뉴스를 아래 형식의 항목으로 정리하세요.

### 1
카테고리: ${cfg.categories[0].key}
헤드라인: 한국어 헤드라인 (60자 이내)
요약: 핵심 내용 요약 (100~150자 한국어). 검색으로 확인한 사실만 쓰고, 기사에 있는 구체적 수치·고유명사를 포함하세요.
출처: 출처 언론사명
검색어: 원문 기사를 다시 찾을 수 있는 키워드 3~4개. 원문 기사 제목에 나오는 회사·제품·인물 같은 고유명사 위주로, 원문 기사의 언어 그대로 씁니다 (영어 기사면 영어).
중요도: high

규칙:
- 총 ${want}개: ${quota} 권장
- 카테고리는 반드시 ${allowed} 중 하나
- 중요도는 high 또는 medium
- 각 항목은 "### 번호"로 시작하고, 위 여섯 줄만 씁니다. 머리말·맺음말·표는 쓰지 않습니다.
- 서로 다른 뉴스여야 하며, 같은 사건을 두 번 넣지 않습니다.`;
}

// "### N" 블록을 항목으로 파싱. 각 항목의 원문 내 위치(start/end)를 함께 돌려주어
// groundingSupports의 문장 위치와 대조할 수 있게 한다.
function parseNewsList(raw) {
  const text = String(raw || "");
  const re = /^\s*#{1,4}\s*(\d+)\s*[.)]?\s*$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(text))) heads.push({ id: Number(m[1]), start: m.index, bodyStart: m.index + m[0].length });
  if (heads.length === 0) throw new Error("목록 항목(### N)을 찾을 수 없습니다");
  const items = [];
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    const body = text.slice(heads[i].bodyStart, end);
    const field = (label) => {
      const fm = body.match(new RegExp(`^\\s*[-*]?\\s*\\**${label}\\**\\s*[:：]\\s*(.+?)\\s*$`, "m"));
      return fm ? fm[1].replace(/\*\*/g, "").trim() : "";
    };
    const headline = field("헤드라인");
    if (!headline) continue; // 잘린 마지막 블록 등
    // Claude 형식에는 "URL:" 줄이 있다. <주소>·마크다운 링크로 감싸도 첫 주소만 뽑는다.
    const url = (field("URL").match(/https?:\/\/[^\s<>()\]]+/) || [null])[0]?.replace(/[.,;]+$/, "") || null;
    items.push({
      id: heads[i].id,
      category: field("카테고리"),
      headline,
      summary: field("요약"),
      source: field("출처"),
      keywords: field("검색어"),
      importance: /medium/i.test(field("중요도")) ? "medium" : "high",
      url,
      _start: heads[i].start,
      _end: end,
    });
  }
  if (items.length === 0) throw new Error("복구 가능한 뉴스 항목이 없습니다");
  return { items };
}

// groundingSupports: [{ segment: { startIndex, endIndex, text }, groundingChunkIndices: [..] }]
// 각 support의 문장이 어느 항목 블록 안에 있는지 찾아, 그 항목에 chunk 인덱스를 모은다.
// 항목의 url은 가장 많이 인용된 chunk의 URI(vertexaisearch 리다이렉트)로 둔다.
// segment.startIndex는 UTF-8 바이트 오프셋이라 한국어에서는 문자 인덱스와 다르므로
// 우선 segment.text로 위치를 찾고, 없을 때만 바이트→문자 변환을 쓴다.
function attachGroundingSources(items, text, groundingMetadata) {
  const supports = groundingMetadata?.groundingSupports || [];
  const chunks = groundingMetadata?.groundingChunks || [];
  const votes = new Map(); // item index -> Map(chunkIdx -> count)
  const byteToChar = (b) => Buffer.from(text, "utf8").subarray(0, b).toString("utf8").length;
  for (const sp of supports) {
    const seg = sp?.segment || {};
    const idxs = sp?.groundingChunkIndices || [];
    if (idxs.length === 0) continue;
    let pos = seg.text ? text.indexOf(seg.text) : -1;
    if (pos === -1 && Number.isFinite(seg.startIndex)) pos = byteToChar(seg.startIndex);
    if (pos === -1) continue;
    const i = items.findIndex((it) => pos >= it._start && pos < it._end);
    if (i === -1) continue;
    const v = votes.get(i) || new Map();
    for (const ci of idxs) v.set(ci, (v.get(ci) || 0) + 1);
    votes.set(i, v);
  }
  let attached = 0;
  items.forEach((it, i) => {
    const v = votes.get(i);
    if (v && v.size) {
      const best = [...v.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const uri = chunks[best]?.web?.uri;
      if (uri) { it.url = uri; attached++; }
    }
    delete it._start;
    delete it._end;
  });
  return attached;
}

// 모델 세대별 출력 형식. NEWS_FORMAT=json|list 로 강제할 수 있다.
export function outputFormatFor(model) {
  if (isClaudeModel(model)) return "list"; // 출처는 검색 결과·인용으로 확인하므로 JSON 강제 불필요
  const forced = String(process.env.NEWS_FORMAT || "").trim().toLowerCase();
  if (forced === "json" || forced === "list") return forced;
  return /^gemini-3/.test(model) ? "list" : "json";
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 모델이 준 검색어를 검색창에 넣기 좋은 형태로 정리한다. 쓸 수 없으면 빈 문자열.
// 괄호 속 설명("(영어)" 같은 주석)과 따옴표·구분 기호를 지우고 공백으로 이어 붙인다.
export function cleanKeywords(raw) {
  let s = String(raw ?? "")
    .replace(/\([^)]*\)|（[^）]*）/g, " ")
    .replace(/[`"“”‘’«»<>\[\]{}*]/g, " ")
    .replace(/[,;|/·、，]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || /https?:|www\./i.test(s)) return "";
  if (s.length > 100) s = s.slice(0, 100).replace(/\s+\S*$/, "");
  return s;
}

// 원문 주소를 확인하지 못한 기사에 붙이는 대체 링크: Google 검색의 뉴스 탭.
// 검색어는 모델이 준 원문 키워드를 쓰고, 없을 때만 한국어 헤드라인을 쓴다.
// 예전에는 news.google.com 검색에 한국어 헤드라인 전체를 넣었는데 두 가지 문제가 있었다
// (2026-10-05 점검, 최근 10일 대체 링크 9건):
//  - 모델이 영어 기사를 옮겨 쓴 문장이라 같은 표현의 기사가 없어 9건 중 4건이 결과 0건
//    (같은 사건을 키워드 "테슬라 옵티머스 기가 텍사스"로 찾으면 44건)
//  - 모바일에서 "콘텐츠를 찾을 수 없습니다"가 떴다는 사용자 보고. 안드로이드에서는 Google 뉴스 앱이
//    news.google.com 링크를 여는 검증된 앱으로 등록돼 있어(news.google.com/.well-known/assetlinks.json)
//    검색 링크가 앱으로 열린 것으로 보인다. google.com 검색 링크는 이 등록과 무관하다.
export function newsSearchLink(headline, keywords) {
  const q = cleanKeywords(keywords) || String(headline ?? "").trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=nws&hl=ko`;
}

// 대체 링크가 된 사유 (로그와 판정 리포트용)
export const FALLBACK_REASON_LABEL = {
  "no-source": "출처 연결 안 됨",
  "redirect-failed": "출처 주소 확인 실패",
  "not-article": "기사 주소 아님",
  "dead": "직접 URL 접속 실패",
};

// 로그용 짧은 주소: 호스트 + 경로 (쿼리 제외)
function shortUrl(u) {
  try {
    const x = new URL(u);
    const s = x.hostname.replace(/^www\./, "") + x.pathname;
    return s.length > 70 ? s.slice(0, 67) + "..." : s;
  } catch {
    return String(u).slice(0, 70);
  }
}

// URL이 (톱/섹션 페이지가 아니라) 개별 기사로 보이는지 휴리스틱 판별
function isLikelyArticle(u) {
  try {
    const { pathname } = new URL(u);
    const segs = pathname.split("/").filter(Boolean);
    if (segs.length === 0) return false; // 도메인 루트 = 톱페이지
    const last = segs[segs.length - 1];
    // 기사 신호: 숫자 ID(5자리+)/날짜 경로, 긴 제목 슬러그, 흔한 기사 경로 패턴
    return (
      /\d{5,}/.test(pathname) ||            // 기사 ID (섹션엔 잘 없는 긴 숫자)
      /\d{4}\/\d{2}\/\d{2}/.test(pathname) || // /2026/06/15/ 날짜 경로
      last.length >= 16 ||                  // 긴 제목-기반 슬러그
      /(article|news\/view|story|read|post|entry|\/news\/.+\/)/i.test(pathname)
    );
  } catch {
    return false;
  }
}

// 모델은 vertex 리다이렉트 URL을 자주 잘라먹어(truncate) 죽은 링크로 만든다.
// groundingChunks에는 잘리지 않은 정식 URL이 있으므로, 토큰 접두사 매칭으로 복원한다.
function redirectToken(u) {
  const m = String(u || "").match(/grounding-api-redirect\/([^?&#"]+)/);
  return m ? m[1] : null;
}
function canonicalizeVertex(rawUrl, chunkUris) {
  const rt = redirectToken(rawUrl);
  if (!rt) return rawUrl;
  let best = null, bestLen = 0;
  for (const cu of chunkUris) {
    const ct = redirectToken(cu);
    if (!ct) continue;
    const [shorter, longer] = rt.length < ct.length ? [rt, ct] : [ct, rt];
    if (longer.startsWith(shorter) && shorter.length > bestLen) {
      best = cu;
      bestLen = shorter.length;
    }
  }
  return best || rawUrl;
}

// 그라운딩 리다이렉트(vertexaisearch)에서 발행처의 실제 기사 URL을 추출.
// manual로 Location 헤더(원 기사 URL)를 우선 사용 — 사이트의 봇-튕김(톱페이지로 redirect)을 회피.
async function unwrapRedirect(url) {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const loc = r.headers.get("location");
    if (loc) return loc;
  } catch {}
  // Location이 없으면 끝까지 따라가서라도 최종 주소 확보
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "User-Agent": UA } });
    if (r.ok && !r.url.includes("vertexaisearch.cloud.google.com")) return r.url;
  } catch {}
  return null;
}

// 모델이 직접 준 (그라운딩 아닌) URL이 실제로 살아있는지 확인 — 환각 404 방지
async function isAlive(url) {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "User-Agent": UA } });
    return r.ok;
  } catch {
    return false;
  }
}

// 모델이 주는 url은 (1) Google 그라운딩 리다이렉트(만료되면 404, 톱페이지로 풀리기도 함)
// 또는 (2) 환각으로 만든 가짜 주소인 경우가 많다.
// → 수집 시점에 발행처의 실제 "기사" URL로 변환하고, 기사로 보이지 않으면
//   검색 대체 링크(newsSearchLink)로 바꾼다.
//
// 반환: { url, status, reason?, detail? }
//   status = "grounded" : 그라운딩 리다이렉트 → 발행처 실제 기사 URL로 복원됨,
//                         또는 Claude 웹 검색 결과에 실제로 나온 기사 주소(verified)
//            "direct"   : 모델 직접 URL이 기사 형태이고 실제 접속됨
//            "fallback" : 실패 → 검색 대체 링크. reason은 FALLBACK_REASON_LABEL의 키,
//                         detail은 기사로 인정하지 못한 주소(있을 때)
async function resolveLink(rawUrl, headline, chunkUris, keywords, verified = false) {
  const fallback = (reason, detail = "") =>
    ({ url: newsSearchLink(headline, keywords), status: "fallback", reason, detail });
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return fallback("no-source");

  // Claude 웹 검색 결과에 그대로 나온 주소: 방금 검색 엔진이 가져온 페이지라 접속 확인은 생략한다
  // (봇을 막는 언론사가 많아 Actions에서 확인하면 멀쩡한 기사도 403으로 떨어진다).
  if (verified) {
    return isLikelyArticle(rawUrl) ? { url: rawUrl, status: "grounded" } : fallback("not-article", shortUrl(rawUrl));
  }

  if (rawUrl.includes("vertexaisearch.cloud.google.com")) {
    // 모델이 잘라먹은 URL을 정식 chunk URL로 복원한 뒤 발행처 기사 URL 추출
    const canonical = canonicalizeVertex(rawUrl, chunkUris);
    const real = await unwrapRedirect(canonical);
    if (!real) return fallback("redirect-failed");
    // 발행처 기사 URL이면 사용, 톱/섹션/영상 페이지 등이면 검색 대체 링크
    return isLikelyArticle(real) ? { url: real, status: "grounded" } : fallback("not-article", shortUrl(real));
  }

  // 그라운딩이 아닌 모델 직접 URL: 기사 형태 + 실제 접속 가능할 때만 사용
  if (!isLikelyArticle(rawUrl)) return fallback("not-article", shortUrl(rawUrl));
  if (await isAlive(rawUrl)) return { url: rawUrl, status: "direct" };
  return fallback("dead", shortUrl(rawUrl));
}

// 모든 항목의 링크를 변환하고, 각 항목에 linkStatus를 기록한 뒤 집계를 반환.
// real = 실제 기사 URL로 확정된 항목 수(grounded + direct). 이 수가 낮으면
// 그라운딩 없이(=환각으로) 생성된 배치일 가능성이 높다.
async function resolveAllLinks(items, chunkUris) {
  await Promise.all(
    items.map(async (it) => {
      const { url, status, reason, detail } = await resolveLink(it.url, it.headline, chunkUris, it.keywords, it.sourceVerified);
      it.url = url;
      it.linkStatus = status;
      if (status === "fallback") {
        it.linkFallback = { reason, detail, query: cleanKeywords(it.keywords) || it.headline };
      } else {
        delete it.linkFallback;
      }
    })
  );
  const count = (s) => items.filter((it) => it.linkStatus === s).length;
  const grounded = count("grounded");
  const direct = count("direct");
  const fallback = count("fallback");
  return { grounded, direct, fallback, real: grounded + direct, total: items.length };
}

// 이 개수 미만이면 응답이 잘린 것(MAX_TOKENS)으로 보고 재시도 (목표 개수의 절반)
const MIN_ITEMS = Math.max(1, Math.ceil(config.total / 2));
// 실제 기사 URL로 확정된 링크가 이 개수 미만이면 "그라운딩 누락 배치"로 보고 재시도.
// 근거: 503 재시도 뒤 성공한 날(예: 2026-09-17)에 Google 검색 없이 모델 기억만으로
// 만든 일반론·가짜 뉴스 10건이 그대로 발송된 사례가 있었다. 그런 배치는 URL이 전부
// 환각이라 링크 검증에서 거의 0건만 살아남는다. 정상 배치는 보통 절반 이상 살아남는다
// (후보 20건 요청 시 정상일 12~16건, 환각일 2~3건 — 2026-09-20~25 로그).
// 기준값은 요청 건수에 비례한다: 기본 30%, 최소 3건 (10건 요청 → 3, 20건 요청 → 6).
// MIN_GROUNDED_LINKS 환경변수로 절대 개수를 지정할 수 있고 0이면 가드를 끈다.
// Actions에서 Variable을 등록하지 않으면 빈 문자열이 들어오는데, Number("")는 0이라
// 가드가 조용히 꺼졌던 사고가 있었으므로(2026-09-25) 빈 값은 "미설정"으로 취급한다.
const MIN_GROUNDED_RATIO = 0.3;
export function minGroundedLinks(want) {
  const raw = String(process.env.MIN_GROUNDED_LINKS ?? "").trim();
  if (raw !== "" && Number.isFinite(Number(raw))) return Math.max(0, Number(raw));
  return Math.max(3, Math.ceil(want * MIN_GROUNDED_RATIO));
}
// 항목 수 부족·그라운딩 누락·일시 오류(503 등)를 합쳐 최대 시도 횟수
const MAX_FETCH_ATTEMPTS = 6;
// 기본 모델에서 일시 오류가 이 횟수만큼 누적되면 백업 모델로 전환.
// 503 "high demand"는 보통 수십 초~수 분이면 풀리므로, 2회·10초 만에 넘기던 것을
// 3회·약 1분(20초→40초 대기) 뒤로 늦춘다. 2026-09-24처럼 약한 모델이 반쪽 결과를 내는 것을 줄인다.
const FALLBACK_AFTER = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 오류의 HTTP 상태. Anthropic SDK 오류는 status 속성, Gemini 호출은 "Gemini API 503: ..." 메시지에 있다.
function errorStatus(err) {
  const s = Number(err?.status);
  if (Number.isFinite(s) && s > 0) return s;
  const m = String(err?.message || "").match(/\b([45]\d\d)\b/);
  return m ? Number(m[1]) : 0;
}
// 재시도하면 풀릴 가능성이 있는 일시적 오류(429 rate limit, 5xx 과부하, Anthropic 529 overloaded, 연결 끊김)
function isTransient(err) {
  return [408, 429, 500, 502, 503, 504, 529].includes(errorStatus(err)) ||
    /overloaded|ECONNRESET|socket hang up|Connection error|timed? ?out/i.test(String(err?.message || ""));
}
// 같은 모델로 다시 해도 소용없는 설정 오류(인증 정보 없음·잘못된 키·권한·모델 ID). 바로 백업 모델로 넘긴다.
function isFatal(err) {
  return [400, 401, 403, 404].includes(errorStatus(err));
}
// 모델을 부를 인증 정보가 있는지 (백업 모델로 넘길 수 있는지 판단)
function hasCredentialsFor(model) {
  return isClaudeModel(model) ? hasClaudeCredentials() : Boolean(process.env.GEMINI_API_KEY);
}

// 테스트에서 대기 시간을 줄이기 위한 배율 (운영에서는 미설정 = 1)
const BACKOFF_SCALE = Number(process.env.FETCH_BACKOFF_SCALE) || 1;

// 지수 백오프 + 지터: 2s, 4s, 8s, 16s ... (상한 20s, ±25% 흔들기로 동시 재시도 분산)
// 응답은 왔지만 품질이 나쁜 경우(항목 부족, 그라운딩 누락)에 쓴다.
function backoffMs(attempt) {
  const base = Math.min(2000 * 2 ** (attempt - 1), 20000);
  return Math.round(base * (0.75 + Math.random() * 0.5) * BACKOFF_SCALE);
}
// 일시 오류(429/5xx) 뒤에는 더 길게 기다린다: 20s, 40s, 60s ... (상한 60s)
// 과부하는 몇 초 만에 풀리지 않으므로 짧은 재시도는 같은 503만 반복한다.
function transientBackoffMs(nth) {
  const base = Math.min(20000 * 2 ** (nth - 1), 60000);
  return Math.round(base * (0.75 + Math.random() * 0.5) * BACKOFF_SCALE);
}

// 모델 종류에 따라 Claude 또는 Gemini를 부르고 항목을 파싱한다 (링크 변환 제외).
// { items, chunkUris, finishReason, format } 반환. 실패 시 throw.
async function fetchRawItems(model = MODEL, want = config.total) {
  const todayKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  if (isClaudeModel(model)) {
    return fetchClaudeItems(model, want, { todayKst, parseList: parseNewsList, isArticle: isLikelyArticle });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const e = new Error("GEMINI_API_KEY 환경변수가 없습니다");
    e.status = 401;
    throw e;
  }
  return fetchGeminiItems(apiKey, model, want, todayKst);
}

// Gemini API 호출 + 파싱
async function fetchGeminiItems(apiKey, model, want, todayKst) {
  const format = outputFormatFor(model);
  const PROMPT = format === "list" ? buildListPrompt(config, want) : buildPrompt(config, want);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `오늘은 ${todayKst} (KST)입니다.\n\n${PROMPT}` }],
        }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.3,
          // thinking 토큰도 이 한도에 포함된다. 2.5-flash는 ~2,700토큰, 3.6-flash는
          // ~9,000토큰을 thinking에 쓰므로(2026-09-25 실측 13.8k 합계) 16384면 잘릴 수 있다.
          maxOutputTokens: 32768,
        },
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini API ${res.status}: ${t.slice(0, 500)}`);
  }

  const data = await res.json();
  // 비용 추정용 사용량 (thinking 토큰은 출력 요율로 과금된다)
  const um = data?.usageMetadata;
  if (um) {
    recordUsage({
      provider: "gemini", model, stage: "collect",
      input: (um.promptTokenCount || 0) + (um.toolUsePromptTokenCount || 0),
      output: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0),
    });
  }

  // 응답 텍스트 추출
  const candidate = data?.candidates?.[0];
  // 모델 세대에 따라 그라운딩 메타데이터 위치·형태가 다를 수 있어, 진단용으로 응답 구조를 남긴다.
  if (process.env.DEBUG_GEMINI_RESPONSE) {
    const gm = candidate?.groundingMetadata;
    const parts = candidate?.content?.parts || [];
    console.log("[debug] candidate keys:", Object.keys(candidate || {}).join(", "));
    console.log("[debug] parts:", parts.map((p) => Object.keys(p).join("+")).join(" | "));
    console.log("[debug] groundingMetadata keys:", gm ? Object.keys(gm).join(", ") : "(없음)");
    console.log("[debug] groundingChunks:", JSON.stringify(gm?.groundingChunks?.slice(0, 3) ?? null));
    console.log("[debug] groundingSupports:", JSON.stringify(gm?.groundingSupports?.slice(0, 2) ?? null));
    console.log("[debug] webSearchQueries:", JSON.stringify(gm?.webSearchQueries ?? null));
    console.log("[debug] urlContextMetadata:", JSON.stringify(candidate?.urlContextMetadata ?? null)?.slice(0, 600));
    console.log("[debug] usageMetadata:", JSON.stringify(data?.usageMetadata ?? null));
    const text = parts.map((p) => p.text || "").join("");
    const urls = [...text.matchAll(/"url"\s*:\s*"([^"]+)"/g)].slice(0, 5).map((m) => m[1]);
    console.log("[debug] 모델이 준 url 앞 5개:", JSON.stringify(urls));
  }
  if (!candidate) {
    throw new Error(`Gemini 응답에 candidates 없음: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const parts = candidate.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("").trim();
  if (!text) {
    const reason = candidate.finishReason || "unknown";
    throw new Error(`Gemini 텍스트 응답 없음. finishReason: ${reason}`);
  }

  const parsed = format === "list" ? parseNewsList(text) : parseNewsJSON(text);

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error("뉴스 항목을 가져오지 못했습니다");
  }
  // 검색 대체 링크용 키워드 정리 (JSON은 배열로 줄 수도 있어 문자열로 통일)
  for (const it of parsed.items) it.keywords = cleanKeywords(it.keywords);

  const chunkUris = (candidate.groundingMetadata?.groundingChunks || [])
    .map((c) => c?.web?.uri)
    .filter(Boolean);

  if (format === "list") {
    const attached = attachGroundingSources(parsed.items, text, candidate.groundingMetadata);
    console.log(
      `[fetch-news] 목록 형식: 항목 ${parsed.items.length}개, ` +
      `groundingSupports ${candidate.groundingMetadata?.groundingSupports?.length ?? 0}개 → 출처 붙은 항목 ${attached}개, ` +
      `검색어 있는 항목 ${parsed.items.filter((it) => it.keywords).length}개`
    );
  }

  return { items: parsed.items, chunkUris, finishReason: candidate.finishReason || "unknown", format };
}

// want: 모델에 요청할 건수 (기본 config.total). 선별 단계가 있으면 config.candidates를 넘긴다.
export async function fetchNews({ want = config.total } = {}) {
  // 백업 모델은 인증 정보가 있을 때만 쓴다 (예: Claude 기본 + GEMINI_API_KEY 있음 → Gemini로 넘김)
  let fallbackBroken = false; // 백업 모델 자체가 실패(잘못된 ID, 할당량 0 등)하면 기본 모델로 복귀
  const fallbackUsable = () =>
    Boolean(FALLBACK_MODEL) && FALLBACK_MODEL !== MODEL && !fallbackBroken && hasCredentialsFor(FALLBACK_MODEL);
  console.log(`[fetch-news] 목표 ${config.total}건, 요청 ${want}건 (모델 ${MODEL}, 백업 ${fallbackUsable() ? FALLBACK_MODEL : "없음"})`);

  // 항목이 너무 적으면(잘림) 또는 실제 기사 링크가 너무 적으면(그라운딩 누락=환각 의심)
  // 재시도하며, 가장 좋은 결과(실제 링크 수 → 항목 수 순)를 보관한다.
  // index.mjs의 withRetry는 "에러"일 때만 재시도하므로, 이런 "성공했지만 나쁜" 케이스는
  // 여기서 직접 잡아야 한다. 링크 변환은 시도마다 수행해 판정 근거로 쓴다.
  let best = null;
  let lastErr = null;
  let transientFails = 0; // 기본 모델의 누적 일시 오류 수
  let primaryBroken = false; // 기본 모델의 설정 오류(인증·권한·모델 ID) → 남은 시도는 백업 모델로
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    // 기본 모델이 일시 오류로 거듭 막히거나 설정 오류로 못 쓰면 백업 모델로 전환해 발송 누락을 막는다.
    const useFallback = fallbackUsable() && (primaryBroken || transientFails >= FALLBACK_AFTER);
    if (primaryBroken && !useFallback) break; // 기본 모델은 고장, 백업도 없음 → 같은 오류만 반복된다
    const model = useFallback ? FALLBACK_MODEL : MODEL;
    // lite 백업 모델은 출력이 잘리기 쉽고(2026-09-24: 9건에서 MAX_TOKENS) 그라운딩도 약하므로
    // 후보를 넉넉히 받는 대신 목표 건수만 요청한다.
    const askFor = useFallback && /lite/i.test(model) ? Math.min(want, config.total) : want;
    const minGrounded = minGroundedLinks(askFor);
    let waitMs = 0;
    try {
      const r = await fetchRawItems(model, askFor);
      // 링크를 실제 기사 URL로 변환·검증 (만료/404/톱페이지 방지) + 품질 집계
      r.stats = await resolveAllLinks(r.items, r.chunkUris);
      r.model = model;
      r.minGrounded = minGrounded;
      console.log(
        `[fetch-news] 시도 ${attempt}/${MAX_FETCH_ATTEMPTS} ${model} (${r.format}): ` +
        `항목 ${r.items.length}개, 검색 출처 ${r.chunkUris.length}개, ` +
        `실제 기사 링크 ${r.stats.real}/${r.stats.total} ` +
        `(출처 확인 ${r.stats.grounded}, 직접 URL ${r.stats.direct}, 검색 폴백 ${r.stats.fallback}), ` +
        `finishReason: ${r.finishReason}`
      );
      if (isBetter(r, best)) best = r;

      const enoughItems = r.items.length >= MIN_ITEMS;
      // 기본 모델이 검색 출처를 하나도 안 돌려줬다면 웹 검색이 실행되지 않은 것
      // (2026-09-25: chunk 0개, 직접 URL 3건이 살아 있어 개수 기준만으로는 통과했던 환각 배치).
      // 백업 모델은 chunk 없이도 리다이렉트 URL을 주는 경우가 있어 개수 기준만 적용한다.
      const noSearch = !useFallback && r.chunkUris.length === 0 && minGrounded > 0;
      const grounded = r.stats.real >= minGrounded && !noSearch;
      if (enoughItems && grounded) break; // 충분히 모이고 근거도 있으면 종료

      if (!enoughItems) {
        console.error(
          `[fetch-news] ${model}: ${r.items.length}개만 수집됨(finishReason: ${r.finishReason}). ` +
          `재시도 ${attempt}/${MAX_FETCH_ATTEMPTS}`
        );
      } else if (noSearch) {
        console.error(
          `[fetch-news] ${model}: 검색 출처 0개 — 웹 검색 미실행(환각 배치) 의심 → ` +
          `재시도 ${attempt}/${MAX_FETCH_ATTEMPTS}`
        );
      } else {
        console.error(
          `[fetch-news] ${model}: 실제 기사 링크가 ${r.stats.real}개뿐(최소 ${minGrounded}개). ` +
          `검색 근거 누락(환각 배치) 의심 → 재시도 ${attempt}/${MAX_FETCH_ATTEMPTS}`
        );
      }
      waitMs = backoffMs(attempt);
    } catch (e) {
      lastErr = e;
      if (useFallback) {
        // 백업 모델이 실패하면 남은 시도는 기본 모델로 (모델 ID 오류·할당량 0 등은 재시도해도 같다)
        fallbackBroken = true;
        console.error(
          `[fetch-news] 백업 모델 ${model} 호출 실패: ${e.message} → ` +
          `${primaryBroken ? "기본 모델도 쓸 수 없어 중단" : `기본 모델 ${MODEL}로 복귀`} ` +
          `(재시도 ${attempt}/${MAX_FETCH_ATTEMPTS})`
        );
        waitMs = primaryBroken ? 0 : transientBackoffMs(Math.max(1, transientFails));
      } else if (isFatal(e)) {
        primaryBroken = true;
        console.error(
          `[fetch-news] ${model} 설정 오류: ${e.message} → ` +
          `${fallbackUsable() ? `백업 모델 ${FALLBACK_MODEL}로 전환` : "백업 모델이 없어 중단"} ` +
          `(재시도 ${attempt}/${MAX_FETCH_ATTEMPTS})`
        );
      } else if (isTransient(e)) {
        transientFails++;
        console.error(
          `[fetch-news] ${model} 호출 실패: ${e.message} (재시도 ${attempt}/${MAX_FETCH_ATTEMPTS}, ` +
          `일시 오류 ${transientFails}/${FALLBACK_AFTER}회 — 이후 백업 모델 전환)`
        );
        // 다음 시도가 백업 모델이면 기다릴 이유가 없다 (다른 모델의 용량)
        const switching = transientFails >= FALLBACK_AFTER && fallbackUsable();
        waitMs = switching ? 0 : transientBackoffMs(transientFails);
      } else {
        console.error(
          `[fetch-news] ${model} 호출 실패: ${e.message} (재시도 ${attempt}/${MAX_FETCH_ATTEMPTS})`
        );
        waitMs = backoffMs(attempt);
      }
    }
    if (attempt < MAX_FETCH_ATTEMPTS && waitMs > 0) {
      console.log(`[fetch-news] ${Math.round(waitMs / 1000)}초 대기 후 재시도`);
      await sleep(waitMs);
    }
  }

  if (!best) throw lastErr || new Error("뉴스 수집에 실패했습니다");
  if (best.items.length < MIN_ITEMS) {
    console.error(`[fetch-news] 재시도 후에도 ${best.items.length}개만 확보. 그대로 발송합니다.`);
  }
  if (best.stats.real < best.minGrounded) {
    console.error(
      `[fetch-news] 재시도 후에도 실제 기사 링크 ${best.stats.real}개뿐(최소 ${best.minGrounded}개). ` +
      `근거 불충분한 배치일 수 있으나 발송 누락보다는 낫다고 보고 그대로 발송합니다.`
    );
  }

  // 카테고리를 설정의 key로 정규화. 설정에 없는 값이면 첫 카테고리로 대체하고 로그를 남긴다.
  for (const it of best.items) {
    const key = normalizeCategory(it.category);
    if (key) {
      it.category = key;
    } else {
      console.error(`[fetch-news] 설정에 없는 카테고리 "${it.category}" → "${defaultCategory.key}"로 대체 (허용: ${categoryKeys.join(", ")})`);
      it.category = defaultCategory.key;
    }
  }

  // importance 순 정렬
  const order = { high: 0, medium: 1 };
  best.items.sort((a, b) => (order[a.importance] ?? 1) - (order[b.importance] ?? 1));

  return { items: best.items, fetchedAt: new Date(), stats: best.stats, model: best.model };
}

// 시도 결과 비교: 실제 기사 링크가 많은 쪽 → 같으면 항목이 많은 쪽
function isBetter(r, best) {
  if (!best) return true;
  if (r.stats.real !== best.stats.real) return r.stats.real > best.stats.real;
  return r.items.length > best.items.length;
}
