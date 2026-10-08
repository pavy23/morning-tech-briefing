// src/email-template.mjs
// 웹 카드 디자인을 이메일 호환 HTML(table + 인라인 스타일)로 재현
// 카테고리 이름·색상·브리핑 제목은 briefing.config.json에서 온다.

import { config, categoryMap, defaultCategory } from "./config.mjs";

const TITLE = config.title;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatKSTDate(d) {
  return d.toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
    timeZone: "Asia/Seoul",
  });
}
function formatKSTTime(d) {
  return d.toLocaleTimeString("ko-KR", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
  });
}

// "claude-sonnet-5-5" → "Claude Sonnet 5.5", "gemini-3.6-flash" → "Gemini 3.6 Flash"
export function modelDisplayName(id) {
  const s = String(id || "");
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  let m = s.match(/^claude-([a-z]+)-(\d+)-(\d+)/i);
  if (m) return `Claude ${cap(m[1])} ${m[2]}.${m[3]}`;
  m = s.match(/^gemini-(\d+(?:\.\d+)?)-([a-z]+)(-lite)?/i);
  if (m) return `Gemini ${m[1]} ${cap(m[2])}${m[3] ? "-Lite" : ""}`;
  return s || "AI";
}
const providerName = (id) => (/^gemini/i.test(String(id)) ? "Gemini" : "Claude");

function renderCard(item, idx) {
  const cat = categoryMap[item.category] || defaultCategory;
  const num = String(idx + 1).padStart(2, "0");
  const isHigh = item.importance === "high";

  return `
  <tr>
    <td style="padding:0 0 12px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0d1525" style="background-color:#0d1525;border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${cat.color};border-radius:0 12px 12px 0;">
        <tr>
          <td style="padding:16px 18px;">
            <!-- 상단 메타 -->
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:9px;">
              <tr>
                <td style="vertical-align:middle;">
                  <span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:50%;background:${cat.bg};color:${cat.color};font-size:10px;font-weight:800;border:1px solid ${cat.color};">${num}</span>
                </td>
                <td style="vertical-align:middle;padding-left:8px;">
                  <span style="display:inline-block;padding:2px 8px;border-radius:20px;background:${cat.bg};color:${cat.color};font-size:10px;font-weight:800;">${esc(item.category)}</span>
                  ${isHigh ? `<span style="display:inline-block;padding:2px 7px;border-radius:20px;background:#302812;color:#FFC832;font-size:10px;font-weight:700;margin-left:6px;">🔥 주목</span>` : ""}
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span style="color:#5A6A7E;font-size:11px;">${esc(item.source)}</span>
                </td>
              </tr>
            </table>
            <!-- 헤드라인 -->
            <div style="font-size:15px;font-weight:700;color:#D8E4F2;line-height:1.4;margin-bottom:8px;">${esc(item.headline)}</div>
            <!-- 요약 -->
            <div style="font-size:13px;color:#8a9bb0;line-height:1.65;margin-bottom:14px;">${esc(item.summary)}</div>
            <!-- 링크 버튼 -->
            ${item.url ? `<a href="${esc(item.url)}" target="_blank" style="display:inline-block;padding:8px 14px;border-radius:8px;background:${cat.bg};color:${cat.color};font-size:12px;font-weight:600;text-decoration:none;border:1px solid ${cat.color};">${linkLabel(item)}</a>` : `<span style="font-size:11px;color:#3A4A5E;">링크 정보 없음</span>`}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

export function buildEmailHTML({ items, fetchedAt, model, costLine, costAlert }) {
  const dateLabel = formatKSTDate(fetchedAt);
  const timeLabel = formatKSTTime(fetchedAt);
  const cards = items.map((it, i) => renderCard(it, i)).join("");

  const catBadges = config.categories
    .map((v) =>
      `<span style="display:inline-block;padding:4px 10px;border-radius:20px;background:${v.bg};color:${v.color};font-size:11px;font-weight:700;margin-right:6px;">${esc(v.key)}</span>`
    )
    .join("");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<!-- 이 메일은 다크 디자인 전용 → 클라이언트가 라이트로 반전하지 않도록 명시 -->
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(TITLE)}</title>
<style>
  :root { color-scheme: dark; supported-color-schemes: dark; }
  /* 일부 클라이언트의 자동 라이트 변환에도 배경/글자색 유지 */
  body, .bg-page { background-color: #080C14 !important; }
  @media (prefers-color-scheme: light) {
    body, .bg-page { background-color: #080C14 !important; }
  }
</style>
</head>
<body class="bg-page" bgcolor="#080C14" style="margin:0;padding:0;background-color:#080C14;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#080C14" class="bg-page" style="background-color:#080C14;">
  <tr>
    <td align="center" bgcolor="#080C14" style="padding:0;background-color:#080C14;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;font-family:'Apple SD Gothic Neo',-apple-system,'Malgun Gothic',sans-serif;">

        <!-- 헤더 -->
        <tr>
          <td bgcolor="#0D1525" style="background-color:#0D1525;border-bottom:1px solid rgba(0,212,255,0.15);padding:28px 24px 22px;">
            <div style="font-size:11px;letter-spacing:0.15em;color:#5A6A7E;text-transform:uppercase;font-weight:600;margin-bottom:6px;">● Daily Tech Briefing</div>
            <div style="font-size:26px;font-weight:800;color:#00D4FF;letter-spacing:-0.02em;">${esc(TITLE)}</div>
            <div style="font-size:13px;color:#5A6A7E;margin-top:6px;">${dateLabel} · KST</div>
            <div style="margin-top:16px;">${catBadges}</div>
            <div style="margin-top:14px;padding:10px 14px;border-radius:10px;background:#0a1a24;border:1px solid rgba(0,212,255,0.15);">
              <span style="color:#AAB8C8;font-size:12px;font-weight:600;">오늘 ${timeLabel} 자동 수집</span>
              <span style="color:#5A7A8E;font-size:12px;"> · 매일 아침 KST 발송</span>
            </div>
          </td>
        </tr>
${costAlert ? `
        <!-- 비용 경고 (월 환산이 기준을 넘을 때만) -->
        <tr>
          <td style="padding:16px 24px 0;">
            <div style="padding:12px 14px;border-radius:10px;background:#302812;border:1px solid #FFC832;color:#FFC832;font-size:12px;line-height:1.6;">⚠️ ${esc(costAlert)}</div>
          </td>
        </tr>
` : ""}
        <!-- 본문 카드 -->
        <tr>
          <td style="padding:24px 24px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${cards}
            </table>
          </td>
        </tr>

        <!-- 푸터 -->
        <tr>
          <td style="padding:8px 24px 36px;">
            <div style="padding:16px 18px;background:#0a1620;border:1px solid rgba(0,212,255,0.1);border-radius:10px;font-size:12px;color:#5A6A7E;line-height:1.7;">
              📌 ${esc(config.topicLabel)} 분야 글로벌 주요 뉴스를 웹 검색으로 모아 매일 아침(KST) 보내 드립니다. · 수집 모델: ${esc(modelDisplayName(model))}
            </div>
            ${costLine ? `<div style="margin-top:10px;font-size:11px;color:#3A4A5E;line-height:1.6;">${esc(costLine)}</div>` : ""}
            <div style="text-align:center;margin-top:16px;font-size:11px;color:#3A4A5E;">
              ${esc(TITLE)} · Generated by ${providerName(model)}
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// 원문 주소를 확인하지 못한 기사는 검색 결과로 연결되므로 버튼 문구로 구분한다.
function linkLabel(item) {
  return item.linkStatus === "fallback" ? "🔎 관련 기사 검색 →" : "🔗 원문 보기 →";
}

// 일부 클라이언트용 평문 fallback
export function buildEmailText({ items, fetchedAt, model, costLine, costAlert }) {
  const date = formatKSTDate(fetchedAt);
  const lines = [`${TITLE} — ${date} (KST)`, ""];
  if (costAlert) lines.push(`⚠️ ${costAlert}`, "");
  items.forEach((it, i) => {
    const num = String(i + 1).padStart(2, "0");
    lines.push(`[${num}] (${it.category}) ${it.headline}`);
    lines.push(`     ${it.summary}`);
    lines.push(`     출처: ${it.source}`);
    if (it.url) lines.push(`     ${it.linkStatus === "fallback" ? "관련 기사 검색: " : ""}${it.url}`);
    lines.push("");
  });
  lines.push(`— 매일 아침 KST 발송 · 수집 모델: ${modelDisplayName(model)}`);
  if (costLine) lines.push(`— ${costLine}`);
  return lines.join("\n");
}

export function buildSubject({ fetchedAt, items }) {
  const dateStr = fetchedAt.toLocaleDateString("ko-KR", {
    month: "long", day: "numeric", timeZone: "Asia/Seoul",
  });
  const topHigh = items.find((i) => i.importance === "high");
  const teaser = topHigh ? ` — ${topHigh.headline}` : "";
  // 제목 길이 제한
  const subj = `📡 ${dateStr} ${config.subjectLabel}${teaser}`;
  return subj.length > 78 ? subj.slice(0, 75) + "..." : subj;
}
