#!/usr/bin/env bun

import { extractLinks } from "./extract";
import { checkAll, type CheckResult, type Status } from "./check";

interface Args {
  files: string[];
  fromStdin: boolean;
  concurrency: number;
  timeoutMs: number;
  json: boolean;
  ignorePatterns: RegExp[];
  showOk: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    files: [],
    fromStdin: false,
    concurrency: 16,
    timeoutMs: 10_000,
    json: false,
    ignorePatterns: [],
    showOk: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    switch (v) {
      case "-h":
      case "--help":
        a.help = true;
        break;
      case "-V":
      case "--version":
        a.version = true;
        break;
      case "--stdin":
        a.fromStdin = true;
        break;
      case "--concurrency":
        a.concurrency = parseInt(argv[++i] ?? "16", 10);
        break;
      case "--timeout":
        a.timeoutMs = Math.round(parseFloat(argv[++i] ?? "10") * 1000);
        break;
      case "--ignore":
        a.ignorePatterns.push(new RegExp(argv[++i] ?? ""));
        break;
      case "--json":
        a.json = true;
        break;
      case "--show-ok":
        a.showOk = true;
        break;
      default:
        if (v.startsWith("--")) {
          console.error(`linkchk: unknown flag ${v}`);
          process.exit(2);
        }
        a.files.push(v);
    }
  }
  return a;
}

const HELP = `linkchk — fast parallel link checker for markdown and html

usage:
  linkchk [options] <file>...
  linkchk --stdin [options]

options:
  --concurrency N     parallel fetches (default: 16)
  --timeout S         per-request timeout in seconds (default: 10)
  --ignore PATTERN    skip urls matching this regex (repeatable)
  --json              machine-readable output
  --show-ok           include passing urls in output
  --stdin             read content from stdin instead of files
  -h, --help          show this
  -V, --version       show version

exit codes:
  0   all links ok
  1   at least one broken link or error
  2   bad invocation
`;

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of (Bun.stdin as any).stream()) {
    chunks.push(chunk);
  }
  return new TextDecoder().decode(
    Buffer.concat(chunks as any),
  );
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));

  if (a.help) {
    console.log(HELP);
    return;
  }
  if (a.version) {
    console.log("linkchk 0.1.0");
    return;
  }

  // Gather sources.
  const sources: { name: string; text: string }[] = [];
  if (a.fromStdin) {
    sources.push({ name: "<stdin>", text: await readStdin() });
  }
  if (a.files.length === 0 && !a.fromStdin) {
    console.error(HELP);
    process.exit(2);
  }
  for (const f of a.files) {
    try {
      const text = await Bun.file(f).text();
      sources.push({ name: f, text });
    } catch (err: any) {
      console.error(`linkchk: cannot read ${f}: ${err?.message ?? err}`);
      process.exit(2);
    }
  }

  // Extract + de-dupe across all sources, preserving first occurrence.
  interface Occurrence {
    url: string;
    where: { file: string; line: number }[];
  }
  const seen = new Map<string, Occurrence>();
  for (const s of sources) {
    for (const { url, line } of extractLinks(s.text)) {
      if (a.ignorePatterns.some((r) => r.test(url))) continue;
      const rec = seen.get(url) ?? { url, where: [] };
      rec.where.push({ file: s.name, line });
      seen.set(url, rec);
    }
  }
  const occurrences = [...seen.values()];
  const urls = occurrences.map((o) => o.url);

  if (urls.length === 0) {
    if (a.json) console.log(JSON.stringify({ total: 0, results: [] }));
    else console.log("no links found.");
    return;
  }

  // Pretty printer for live results.
  const SYM: Record<Status, string> = {
    ok: "\x1b[32m✓\x1b[0m",
    broken: "\x1b[31m✗\x1b[0m",
    error: "\x1b[31m✗\x1b[0m",
    skipped: "\x1b[90m-\x1b[0m",
  };
  const byUrl = new Map(occurrences.map((o) => [o.url, o]));

  const results = await checkAll(
    urls,
    a.concurrency,
    { timeoutMs: a.timeoutMs },
    (r) => {
      if (a.json) return;
      if (!a.showOk && r.status === "ok") return;
      if (r.status === "skipped") return;
      const tag =
        r.status === "ok"
          ? `${r.httpCode ?? "???"}`
          : r.status === "broken"
            ? `${r.httpCode ?? "???"}`
            : r.error ?? "error";
      const occ = byUrl.get(r.url)!.where[0]!;
      console.log(`${SYM[r.status]}  ${tag.padEnd(8)} ${r.url}  \x1b[90m(${occ.file}:${occ.line})\x1b[0m`);
    },
  );

  const counts = {
    total: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    broken: results.filter((r) => r.status === "broken").length,
    errored: results.filter((r) => r.status === "error").length,
    skipped: results.filter((r) => r.status === "skipped").length,
  };

  if (a.json) {
    console.log(
      JSON.stringify(
        {
          total: counts.total,
          counts,
          results: results.map((r) => ({
            ...r,
            occurrences: byUrl.get(r.url)?.where ?? [],
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `\n${counts.ok} ok, ${counts.broken} broken, ${counts.errored} errored, ${counts.skipped} skipped  (of ${counts.total})`,
    );
  }

  const failing = counts.broken + counts.errored;
  process.exit(failing > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("linkchk: unexpected error:", err);
  process.exit(1);
});
