// Models may explain a fenced JSON answer; accept one explicit payload and reject ambiguity.
export function parseMemoryExtraction(text: string): unknown {
  const blocks = [...text.matchAll(/```(?:json)?[\t ]*\r?\n([\s\S]*?)```/gi)];
  if (blocks.length > 1) throw new Error("Memory extraction returned multiple JSON blocks");
  return JSON.parse(blocks.length ? blocks[0]![1]!.trim() : text.trim());
}
