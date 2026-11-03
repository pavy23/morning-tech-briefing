// src/article-date.mjs
// 기사 게시일 읽기. Gemini 그라운딩 결과에는 게시 시점이 없어 2년 전 기사가 섞인 적이 있다
// (2026-11-03 검증 실행: ChatGPT Search 출시, 클로드 3.5 소넷 컴퓨터 유즈, 스타십 6차 비행 등 2024년 기사).
// 근거는 믿을 만한 순서로 (1) 기사 페이지의 게시일 메타데이터, (2) 기사 주소 속 날짜, (3) 모델이 적은 게시일.
// 네트워크 없이 문자열만 다루는 함수들이다. 페이지를 받아 오는 쪽은 fetch-news.mjs.

// 이보다 오래된 기사는 뺀다. Claude 수집이 분야 보충에 허용하는 게시 시점(72시간)과 같다.
export const MAX_AGE_HOURS = 72;

const EARLIEST = Date.UTC(2015, 0, 1); // 연도 없는 날짜를 2001년으로 읽는 Date.parse 같은 오독을 버린다

function utcDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d);
}

// "2026-11-02", "2026.11.02", "2026년 11월 2일", ISO 8601, "Nov 2, 2026" 등을 시각(ms)으로. 모르면 null.
export function parseLooseDate(s) {
  const str = String(s ?? "").trim();
  if (!str) return null;
  let t = null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) t = Date.parse(str);
  if (!Number.isFinite(t)) {
    const m = str.match(/(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
    t = m ? utcDate(+m[1], +m[2], +m[3]) : Date.parse(str);
  }
  return Number.isFinite(t) && t >= EARLIEST ? t : null;
}

// 기사 주소 속 날짜: /2024/10/31/, /2024-10-31-…, …-2024-10-31/ 은 그날, /2024/10/… 처럼 연·월만 있으면 그달 말일로 본다
// (오래됐다고 잘못 빼지 않도록 가장 늦은 날짜로). 숫자만 이어진 기사 ID는 날짜와 구별할 수 없어 쓰지 않는다.
export function dateFromUrl(u) {
  let path;
  try {
    path = new URL(u).pathname;
  } catch {
    return null;
  }
  const day = path.match(/[/-](20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?=[/\-_.]|$)/);
  if (day) {
    const t = utcDate(+day[1], +day[2], +day[3]);
    if (t != null && t >= EARLIEST) return t;
  }
  const month = path.match(/\/(20\d{2})\/(\d{1,2})\//);
  if (month && +month[2] >= 1 && +month[2] <= 12) {
    const t = Date.UTC(+month[1], +month[2], 0); // 다음 달 0일 = 그달 말일
    if (t >= EARLIEST) return t;
  }
  return null;
}

// 기사 HTML의 게시일. 게시일 전용 메타데이터와 JSON-LD datePublished를 먼저 보고,
// 없을 때만 뜻이 넓은 date·dc.date를 쓴다. 모르면 null.
const PUBLISHED_KEYS = [
  "article:published_time", "og:article:published_time", "datepublished", "parsely-pub-date",
  "sailthru.date", "pubdate", "publishdate", "publish-date", "publish_date", "article.published",
];
const GENERIC_KEYS = ["date", "dc.date", "dc.date.issued", "dcterms.created"];

export function dateFromHtml(html) {
  const text = String(html ?? "");
  const metas = new Map();
  for (const tag of text.match(/<meta\b[^>]*>/gi) || []) {
    const attr = (n) => tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
    const key = (attr("property") || attr("name") || attr("itemprop") || "").trim().toLowerCase();
    const content = attr("content");
    if (key && content && !metas.has(key)) metas.set(key, content);
  }
  const ld = text.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  for (const v of [...PUBLISHED_KEYS.map((k) => metas.get(k)), ld, ...GENERIC_KEYS.map((k) => metas.get(k))]) {
    const t = parseLooseDate(v);
    if (t != null) return t;
  }
  return null;
}
