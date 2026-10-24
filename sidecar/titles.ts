/**
 * Session titles have to fit a narrow sidebar row and a phone's header. Models ignore "at most N words", so the
 * limit is enforced here: a title is measured in columns (a CJK character takes two, anything else one) and cut at
 * a word boundary when it runs over. About 12 Chinese characters or 24 Latin ones.
 */
export const TITLE_COLUMNS = 24;

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;
const columns = (ch: string) => (WIDE.test(ch) ? 2 : 1);

/** Words that read wrong at the end of a cut title ("Refactor the parser for"). */
const DANGLING = /\s+(?:a|an|the|of|for|and|or|to|in|on|with|about|from|by|at|vs\.?)$/i;

const LABEL = /^\s*(?:title|subject|标题|题目|主题)\s*[:：]\s*/i;
const EDGE_OPEN = /^[\s"'`“”‘’「『《(（\[【#*_>-]+/;
const EDGE_CLOSE = /[\s"'`“”‘’」』》)）\]】*_.。!！?？,，、;；:：…]+$/;

/** The model's reply (or any text) as a short one-line title; `fallback` when nothing usable is left. */
export function clampTitle(raw: string, fallback = ""): string {
  const clean = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean)
      ?.replace(LABEL, "")
      .replace(EDGE_OPEN, "")
      .replace(EDGE_CLOSE, "")
      .replace(/\s+/g, " ") ?? "";
  const title = clean(raw);
  if (!title) return fallback ? clampTitle(fallback) : "";

  const chars = Array.from(title);
  let used = 0;
  let end = 0;
  while (end < chars.length && used + columns(chars[end]) <= TITLE_COLUMNS) used += columns(chars[end++]);
  if (end === chars.length) return title;

  let cut = chars.slice(0, end).join("");
  // Latin text: back up to the last space unless that would throw away most of the title.
  if (chars[end] !== " " && !WIDE.test(chars[end]) && !WIDE.test(chars[end - 1])) {
    const space = cut.lastIndexOf(" ");
    if (space >= TITLE_COLUMNS / 3) cut = cut.slice(0, space);
  }
  return cut.replace(DANGLING, "").replace(EDGE_CLOSE, "").trim();
}
