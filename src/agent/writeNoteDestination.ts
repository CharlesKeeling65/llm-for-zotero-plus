export type WriteNoteDestination = "none" | "zotero" | "file";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesConfiguredNickname(text: string, nickname?: string): boolean {
  const trimmed = (nickname || "").trim();
  if (!trimmed) return false;
  const escaped = escapeRegex(trimmed);
  const isAscii = /^[\x20-\x7E]+$/.test(trimmed);
  const pattern = isAscii
    ? new RegExp(`\\b${escaped}\\b`, "i")
    : new RegExp(escaped, "i");
  return pattern.test(text);
}

function hasPathLikeDestination(text: string): boolean {
  return /(?:^|\s)(?:~\/|\.{1,2}\/|\/[^\s]+|[A-Za-z]:[\\/]|[^\s]+\.md\b)/i.test(
    text,
  );
}

function hasFileDestinationSignal(
  text: string,
  notesDirectoryNickname?: string,
): boolean {
  if (matchesConfiguredNickname(text, notesDirectoryNickname)) return true;
  if (/\b(obsidian|vault)\b/i.test(text)) return true;
  if (/\b(?:markdown|md)\s+files?\b/i.test(text)) return true;
  if (hasPathLikeDestination(text)) return true;
  return /\b(?:save|write|export|send|put|create|make)\b[\s\S]{0,120}\b(?:to|into|as|in|under)\b[\s\S]{0,120}\b(?:files?|folders?|directories|directory|disk|local)\b/i.test(
    text,
  );
}

function hasZoteroDestinationSignal(text: string): boolean {
  return /\b(?:zotero(?:\s+library|\s+note)?|standalone\s+notes?|item\s+notes?|child\s+notes?|current\s+(?:zotero\s+)?notes?|active\s+(?:zotero\s+)?notes?|open\s+(?:zotero\s+)?notes?)\b/i.test(
    text,
  );
}

function hasGenericNoteWriteSignal(text: string): boolean {
  return (
    /\b(?:create|make|write|draft|generate|save|append|add|put|edit|update|modify|rewrite|revise|polish)\b[\s\S]{0,120}\b(?:notes?|summary\s+notes?|reading\s+notes?|study\s+notes?|literature\s+notes?|research\s+notes?)\b/i.test(
      text,
    ) ||
    /\b(?:notes?|summary\s+notes?|reading\s+notes?|study\s+notes?|literature\s+notes?|research\s+notes?)\b[\s\S]{0,120}\b(?:save|write|append|add|create|make|edit|update|modify|rewrite|revise|polish)\b/i.test(
      text,
    ) ||
    /\b(?:reading\s+notes?|study\s+notes?|literature\s+notes?|research\s+notes?)\b/i.test(
      text,
    ) ||
    /\b(?:summari[sz]e)\b[\s\S]{0,120}\b(?:into|as|to)\b[\s\S]{0,120}\bnotes?\b/i.test(
      text,
    )
  );
}

export function classifyWriteNoteDestination(
  userText: string | undefined,
  notesDirectoryNickname?: string,
): WriteNoteDestination {
  const text = (userText || "").trim();
  if (!text) return "none";
  if (hasFileDestinationSignal(text, notesDirectoryNickname)) return "file";
  if (hasZoteroDestinationSignal(text)) return "zotero";
  if (hasGenericNoteWriteSignal(text)) return "zotero";
  return "none";
}
