// Tags & smart labels. A tag is either plain (label_key null, e.g. "asset
// tagging") or a smart label — a key:value pair you can group by (label_key
// "topic", value "asset tagging" → displayed "topic: asset tagging"). See
// migration 0007.

export type Tag = {
  id: string;
  label_key: string | null;
  value: string;
};

export type TagSpec = {
  label_key: string | null;
  value: string;
};

export function tagDisplay(t: TagSpec): string {
  return t.label_key ? `${t.label_key}: ${t.value}` : t.value;
}

// Parse a raw input string into a tag spec. A "key: value" form (first colon
// wins) becomes a smart label; anything else is a plain tag. Keys are
// lowercased so "Topic" and "topic" share one namespace; values keep their
// case. Returns null for empty input.
export function parseTagInput(raw: string): TagSpec | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(":");
  if (idx > 0) {
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const value = trimmed.slice(idx + 1).trim();
    if (key && value) return { label_key: key, value };
  }
  return { label_key: null, value: trimmed };
}
