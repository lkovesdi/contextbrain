type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  const push = (value: ClassValue) => {
    if (!value) return;
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
    } else if (Array.isArray(value)) {
      value.forEach(push);
    } else {
      for (const key in value) {
        if (value[key]) out.push(key);
      }
    }
  };

  inputs.forEach(push);
  return out.join(" ");
}

// Turn a failed AI-route response body into user-facing text. A 402 carries
// { error } JSON from creditErrorResponse (src/lib/credits.ts) — surface that
// message rather than raw JSON; anything else falls through unchanged.
export function apiErrorText(status: number, body: string, fallback: string): string {
  if (status === 402) {
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      /* not JSON — use the default message below */
    }
    return "Out of credits. Buy more in Settings, or add your own API key.";
  }
  return body || fallback;
}
