// Credential scrubbing for repo/content text before it is persisted to the
// database or placed into a model prompt. The worst realistic leak from
// indexing private repos isn't the code — it's a live credential sitting
// inside the code. Rules are shape-based and deliberately conservative:
// redacting a placeholder is harmless, missing a real key is not, but a rule
// that mangles ordinary source text would poison retrieval — so each pattern
// targets a well-known token format or an explicit `secret = "…"` assignment.

type Rule = {
  kind: string;
  re: RegExp;
  // Replacement template; defaults to the bare redaction marker.
  sub?: string;
};

const RULES: Rule[] = [
  // PEM/PGP private key blocks (multi-line, redacted wholesale).
  {
    kind: "private-key",
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/g,
  },
  // Vendor-prefixed API tokens — unambiguous shapes.
  { kind: "aws-key-id", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  {
    kind: "github-token",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g,
  },
  { kind: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "stripe-key", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: "model-api-key", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: "google-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // Signed JWTs (three base64url segments) — covers Supabase service keys.
  {
    kind: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  // Passwords embedded in connection URLs: scheme://user:password@host
  {
    kind: "url-password",
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):([^\s@/]{4,})@/g,
    sub: "$1:[REDACTED:url-password]@",
  },
  // Explicit secret assignments: `api_key = "…"`, `PASSWORD: '…'`, etc.
  // The value charset excludes dots and parens so code like
  // `token = process.env.GITHUB_TOKEN` or `password: z.string()` is left alone.
  {
    kind: "assignment",
    re: /\b(api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token)(["']?\s*[:=]\s*["']?)([A-Za-z0-9_\-/+=]{16,})/gi,
    sub: "$1$2[REDACTED:secret]",
  },
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, rule.sub ?? `[REDACTED:${rule.kind}]`);
  }
  return out;
}
