// src/fetch-news.mjs
// Gemini API + Google Search grounding으로 AI/XR/우주/로봇 뉴스 10개를 수집

const MODEL = process.env.MODEL || "gemini-2.5-flash";

const PROMPT = `당신은 글로벌 테크 뉴스 에디터입니다.
Google 검색을 사용해 오늘 날짜 기준 최근 24시간 이내의 AI, XR(AR/VR/MR), 우주산업, 로봇산업 분야 가장 중요한 글로벌 주요 뉴스를 찾아 아래 JSON 형식으로만 응답하세요.

반드시 아래 JSON 구조로, 코드블록이나 다른 텍스트 없이 순수 JSON만 출력하세요:

{
  "items": [
    {
      "id": 1,
      "category": "AI",
      "headline": "한국어 헤드라인 (60자 이내)",
      "summary": "핵심 내용 요약 (100~150자 한국어)",
      "source": "출처 언론사명",
      "importance": "high",
      "url": "https://원본기사URL"
    }
  ]
}

규칙:
- 총 10개: AI 3개, XR 2개, 우주 2개, 로봇 3개 권장
- category는 반드시 "AI", "XR", "우주", "로봇" 중 하나
- importance는 "high" 또는 "medium"
- url은 반드시 https://로 시작하는 실제 기사 URL
- summary는 150자 이내, 한국어로 작성
- 순수 JSON만 출력`;

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
async function resolveLink(rawUrl, headline, chunkUris) {
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return newsSearchLink(headline);

  if (rawUrl.includes("vertexaisearch.cloud.google.com")) {
    // 모델이 잘라먹은 URL을 정식 chunk URL로 복원한 뒤 발행처 기사 URL 추출
    const canonical = canonicalizeVertex(rawUrl, chunkUris);
    const real = await unwrapRedirect(canonical);
    if (!real) return newsSearchLink(headline);
    // 발행처 기사 URL이면 사용, 톱/섹션 페이지면 기사 검색으로 폴백
    return isLikelyArticle(real) ? real : newsSearchLink(headline);
  }

  // 그라운딩이 아닌 모델 직접 URL: 기사 형태 + 실제 접속 가능할 때만 사용
  if (isLikelyArticle(rawUrl) && (await isAlive(rawUrl))) return rawUrl;
  return newsSearchLink(headline);
}

async function resolveAllLinks(items, chunkUris) {
  await Promise.all(
    items.map(async (it) => {
      it.url = await resolveLink(it.url, it.headline, chunkUris);
    })
  );
  return items;
}

export async function fetchNews() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 환경변수가 없습니다");

  const todayKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
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
          // 2.5-flash는 thinking에 ~2700토큰을 쓰므로 4096이면 JSON이 잘림(MAX_TOKENS).
          // 8192로 올려 10개 항목이 온전히 출력되도록 함.
          maxOutputTokens: 8192,
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

  // importance 순 정렬
  const order = { high: 0, medium: 1 };
  parsed.items.sort((a, b) => (order[a.importance] ?? 1) - (order[b.importance] ?? 1));

  // 링크를 실제 기사 URL로 변환·검증 (만료/404/톱페이지 방지)
  const chunkUris = (candidate.groundingMetadata?.groundingChunks || [])
    .map((c) => c?.web?.uri)
    .filter(Boolean);
  await resolveAllLinks(parsed.items, chunkUris);

  return { items: parsed.items, fetchedAt: new Date() };
}
