export function chunkText(text: string, maxLen = 1200, overlap = 100): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean ? [clean] : [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + maxLen));
    i += maxLen - overlap;
  }
  return chunks;
}
