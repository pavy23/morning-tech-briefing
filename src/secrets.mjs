// src/secrets.mjs
// API 키 환경변수 점검. GitHub Secrets에 키 대신 1Password 비밀 참조(op://볼트/항목/필드)를 넣어 두면
// 워크플로의 1Password 단계가 실행 직전에 실제 키로 바꿔 넘긴다. 참조가 그대로 들어왔다면 그 단계가
// 돌지 않은 것(OP_SERVICE_ACCOUNT_TOKEN 누락)이므로, 엉뚱한 인증 오류 대신 원인을 바로 알린다.

const API_KEY_NAMES = ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "RESEND_API_KEY", "TYPESAFE_API_KEY"];

export function assertSecretsResolved(names = API_KEY_NAMES, env = process.env) {
  const unresolved = names.filter((k) => String(env[k] ?? "").trim().startsWith("op://"));
  if (unresolved.length === 0) return;
  throw new Error(
    `1Password 참조가 실제 키로 바뀌지 않았습니다: ${unresolved.join(", ")} ` +
    "(Secrets에 OP_SERVICE_ACCOUNT_TOKEN이 있는지, 1Password 항목에 값이 있는지 확인하세요. 로컬 실행이면 op run으로)"
  );
}
