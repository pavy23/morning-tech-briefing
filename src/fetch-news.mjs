// src/fetch-news.mjs
// Gemini API + Google Search grounding으로 briefing.config.json에 정의된 주제의 뉴스를 수집

import { config, categoryKeys, defaultCategory, normalizeCategory, quotasFor } from "./config.mjs";

const MODEL = process.env.MODEL || "gemini-2.5-flash";
// 기본 모델이 503/429 같은 일시적 과부하로 거듭 실패할 때 쓸 백업 모델.
// (그라운딩 품질은 다소 낮아도 "메일 누락"보다는 낫다. 같은 모델이면 폴백 비활성.)
// 2.5-flash-lite는 2026-10-16 Gemini API에서 종료 예정이라 3.5-flash-lite를 기본값으로 둔다.
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || "gemini-3.5-flash-lite";

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
      "url": "https://원본기사URL"
    }
  ]
}

규칙:
- 총 ${want}개: ${quota} 권장
- category는 반드시 ${allowed} 중 하나
- importance는 "high" 또는 "medium"
- url은 반드시 https://로 시작하는 실제 기사 URL
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

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 헤드라인으로 Google 뉴스 검색 (해당 기사가 결과 맨 위에 뜸) — 절대 죽지 않는 폴백
function newsSearchLink(headline) {
  return `https://news.google.com/search?q=${encodeURIComponent(headline || "")}&hl=ko&gl=KR&ceid=KR:ko`;
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
//   헤드라인 Google 뉴스 검색 링크로 폴백한다(클릭 시 해당 기사가 맨 위에 노출).
//
// 반환: { url, status }
//   status = "grounded" : 그라운딩 리다이렉트 → 발행처 실제 기사 URL로 복원됨
//            "direct"   : 모델 직접 URL이 기사 형태이고 실제 접속됨
//            "fallback" : 실패 → Google 뉴스 검색 링크
async function resolveLink(rawUrl, headline, chunkUris) {
  const fallback = { url: newsSearchLink(headline), status: "fallback" };
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return fallback;

  if (rawUrl.includes("vertexaisearch.cloud.google.com")) {
    // 모델이 잘라먹은 URL을 정식 chunk URL로 복원한 뒤 발행처 기사 URL 추출
    const canonical = canonicalizeVertex(rawUrl, chunkUris);
    const real = await unwrapRedirect(canonical);
    if (!real) return fallback;
    // 발행처 기사 URL이면 사용, 톱/섹션 페이지면 기사 검색으로 폴백
    return isLikelyArticle(real) ? { url: real, status: "grounded" } : fallback;
  }

  // 그라운딩이 아닌 모델 직접 URL: 기사 형태 + 실제 접속 가능할 때만 사용
  if (isLikelyArticle(rawUrl) && (await isAlive(rawUrl))) return { url: rawUrl, status: "direct" };
  return fallback;
}

// 모든 항목의 링크를 변환하고, 각 항목에 linkStatus를 기록한 뒤 집계를 반환.
// real = 실제 기사 URL로 확정된 항목 수(grounded + direct). 이 수가 낮으면
// 그라운딩 없이(=환각으로) 생성된 배치일 가능성이 높다.
async function resolveAllLinks(items, chunkUris) {
  await Promise.all(
    items.map(async (it) => {
      const { url, status } = await resolveLink(it.url, it.headline, chunkUris);
      it.url = url;
      it.linkStatus = status;
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

// 재시도하면 풀릴 가능성이 있는 일시적 서버 오류(429 rate limit, 5xx 과부하)인지 판별
function isTransient(err) {
  return /\b(429|500|502|503|504)\b/.test(String(err?.message || ""));
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

// Gemini API 호출 + JSON 파싱만 담당 (링크 변환 제외).
// { items, chunkUris, finishReason } 반환. 실패 시 throw.
async function fetchRawItems(apiKey, model = MODEL, want = config.total) {
  const todayKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const PROMPT = buildPrompt(config, want);

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
          // 2.5-flash는 thinking에 ~2700토큰을 쓰므로 8192면 그날 thinking/요약이
          // 길 때 JSON이 잘림(MAX_TOKENS) → 항목 1~2개만 복구됨.
          // 16384로 올려 10개 항목이 온전히 출력될 여유를 확보.
          maxOutputTokens: 16384,
        },
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini API ${res.status}: ${t.slice(0, 500)}`);
  }

  const data = await res.json();

  // 응답 텍스트 추출
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    throw new Error(`Gemini 응답에 candidates 없음: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const parts = candidate.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("").trim();
  if (!text) {
    const reason = candidate.finishReason || "unknown";
    throw new Error(`Gemini 텍스트 응답 없음. finishReason: ${reason}`);
  }

  const parsed = parseNewsJSON(text);

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error("뉴스 항목을 가져오지 못했습니다");
  }

  const chunkUris = (candidate.groundingMetadata?.groundingChunks || [])
    .map((c) => c?.web?.uri)
    .filter(Boolean);

  return { items: parsed.items, chunkUris, finishReason: candidate.finishReason || "unknown" };
}

// want: Gemini에 요청할 건수 (기본 config.total). 선별 단계가 있으면 config.candidates를 넘긴다.
export async function fetchNews({ want = config.total } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 환경변수가 없습니다");
  console.log(`[fetch-news] 목표 ${config.total}건, 요청 ${want}건`);

  // 항목이 너무 적으면(잘림) 또는 실제 기사 링크가 너무 적으면(그라운딩 누락=환각 의심)
  // 재시도하며, 가장 좋은 결과(실제 링크 수 → 항목 수 순)를 보관한다.
  // index.mjs의 withRetry는 "에러"일 때만 재시도하므로, 이런 "성공했지만 나쁜" 케이스는
  // 여기서 직접 잡아야 한다. 링크 변환은 시도마다 수행해 판정 근거로 쓴다.
  let best = null;
  let lastErr = null;
  let transientFails = 0; // 기본 모델의 누적 일시 오류 수
  let fallbackBroken = false; // 백업 모델 자체가 실패(잘못된 ID, 할당량 0 등)하면 기본 모델로 복귀
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    // 기본 모델이 일시 오류로 거듭 막히면 백업 모델로 전환해 발송 누락을 막는다.
    const useFallback =
      !fallbackBroken &&
      transientFails >= FALLBACK_AFTER && FALLBACK_MODEL && FALLBACK_MODEL !== MODEL;
    const model = useFallback ? FALLBACK_MODEL : MODEL;
    // 백업 모델은 출력이 잘리기 쉽고(2026-09-24: 9건에서 MAX_TOKENS) 그라운딩도 약하므로
    // 후보를 넉넉히 받는 대신 목표 건수만 요청한다.
    const askFor = useFallback ? Math.min(want, config.total) : want;
    const minGrounded = minGroundedLinks(askFor);
    let waitMs = 0;
    try {
      const r = await fetchRawItems(apiKey, model, askFor);
      // 링크를 실제 기사 URL로 변환·검증 (만료/404/톱페이지 방지) + 품질 집계
      r.stats = await resolveAllLinks(r.items, r.chunkUris);
      r.model = model;
      r.minGrounded = minGrounded;
      console.log(
        `[fetch-news] 시도 ${attempt}/${MAX_FETCH_ATTEMPTS} ${model}: ` +
        `항목 ${r.items.length}개, 그라운딩 chunk ${r.chunkUris.length}개, ` +
        `실제 기사 링크 ${r.stats.real}/${r.stats.total} ` +
        `(리다이렉트 복원 ${r.stats.grounded}, 직접 URL ${r.stats.direct}, 검색 폴백 ${r.stats.fallback}), ` +
        `finishReason: ${r.finishReason}`
      );
      if (isBetter(r, best)) best = r;

      const enoughItems = r.items.length >= MIN_ITEMS;
      // 기본 모델이 그라운딩 chunk를 하나도 안 돌려줬다면 Google 검색이 실행되지 않은 것
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
          `[fetch-news] ${model}: 그라운딩 chunk 0개 — Google 검색 미실행(환각 배치) 의심 → ` +
          `재시도 ${attempt}/${MAX_FETCH_ATTEMPTS}`
        );
      } else {
        console.error(
          `[fetch-news] ${model}: 실제 기사 링크가 ${r.stats.real}개뿐(최소 ${minGrounded}개). ` +
          `Google 검색 그라운딩 누락(환각 배치) 의심 → 재시도 ${attempt}/${MAX_FETCH_ATTEMPTS}`
        );
      }
      waitMs = backoffMs(attempt);
    } catch (e) {
      lastErr = e;
      if (useFallback) {
        // 백업 모델이 실패하면 남은 시도는 기본 모델로 (모델 ID 오류·할당량 0 등은 재시도해도 같다)
        fallbackBroken = true;
        console.error(
          `[fetch-news] 백업 모델 ${model} 호출 실패: ${e.message} → 기본 모델 ${MODEL}로 복귀 ` +
          `(재시도 ${attempt}/${MAX_FETCH_ATTEMPTS})`
        );
        waitMs = transientBackoffMs(transientFails);
      } else if (isTransient(e)) {
        transientFails++;
        console.error(
          `[fetch-news] ${model} 호출 실패: ${e.message} (재시도 ${attempt}/${MAX_FETCH_ATTEMPTS}, ` +
          `일시 오류 ${transientFails}/${FALLBACK_AFTER}회 — 이후 백업 모델 전환)`
        );
        // 다음 시도가 백업 모델이면 기다릴 이유가 없다 (다른 모델의 용량)
        const switching = transientFails >= FALLBACK_AFTER && FALLBACK_MODEL && FALLBACK_MODEL !== MODEL;
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
