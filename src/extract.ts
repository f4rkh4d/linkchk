// Extract URLs from markdown and html source.
//
// Markdown patterns:
//   [text](https://example.com)        - inline link
//   [text](https://example.com "t")    - inline with title
//   ![alt](https://img.example.com)    - image (treated like a link)
//   <https://example.com>              - autolink
//   [ref]: https://example.com         - reference definition
//
// HTML patterns:
//   <a href="...">, <a href='...'>, <a href=...>
//   <img src="...">, <link href="...">, <script src="...">
//
// Bare URLs in code blocks and inline code are intentionally skipped.

export interface ExtractedLink {
  url: string;
  line: number;
}

const MD_INLINE = /\[(?:[^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const MD_IMAGE = /!\[(?:[^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const MD_AUTOLINK = /<(https?:\/\/[^\s>]+)>/g;
const MD_REFDEF = /^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/gm;

const HTML_HREF = /<(?:a|link)[^>]*\s(?:href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
const HTML_SRC = /<(?:img|script|iframe|source)[^>]*\s(?:src)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;

// Code fences we should skip entirely.
const FENCED_BLOCK = /(^|\n) {0,3}```[\s\S]*?\n {0,3}```/g;
// Inline code spans.
const INLINE_CODE = /`[^`\n]+`/g;

function stripCode(text: string): string {
  return text.replace(FENCED_BLOCK, "\n").replace(INLINE_CODE, "");
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function harvest(
  source: string,
  stripped: string,
  pattern: RegExp,
  out: ExtractedLink[],
  groupIndex: number | number[] = 1,
): void {
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  const groups = Array.isArray(groupIndex) ? groupIndex : [groupIndex];
  while ((m = pattern.exec(stripped)) !== null) {
    let url: string | undefined;
    for (const g of groups) {
      if (m[g] !== undefined) {
        url = m[g];
        break;
      }
    }
    if (!url) continue;
    out.push({ url, line: lineOf(source, m.index) });
    if (m[0].length === 0) pattern.lastIndex++;
  }
}

export function extractLinks(
  source: string,
  format: "md" | "html" | "auto" = "auto",
): ExtractedLink[] {
  const fmt = format === "auto" ? detectFormat(source) : format;
  const stripped = fmt === "md" ? stripCode(source) : source;
  const links: ExtractedLink[] = [];

  if (fmt === "md") {
    harvest(source, stripped, MD_INLINE, links);
    harvest(source, stripped, MD_IMAGE, links);
    harvest(source, stripped, MD_AUTOLINK, links);
    harvest(source, stripped, MD_REFDEF, links);
  }

  // Always try HTML patterns too - markdown files often embed raw html blocks.
  harvest(source, stripped, HTML_HREF, links, [1, 2, 3]);
  harvest(source, stripped, HTML_SRC, links, [1, 2, 3]);

  return dedupe(links);
}

function dedupe(links: ExtractedLink[]): ExtractedLink[] {
  const seen = new Set<string>();
  const out: ExtractedLink[] = [];
  for (const l of links) {
    const key = `${l.url}#${l.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

export function detectFormat(source: string): "md" | "html" {
  const head = source.slice(0, 2048).toLowerCase();
  if (head.includes("<!doctype html") || /<html[\s>]/.test(head)) return "html";
  return "md";
}
