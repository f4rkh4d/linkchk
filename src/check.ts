// Check URLs concurrently with timeout + retry.

export type Status = "ok" | "broken" | "skipped" | "error";

export interface CheckResult {
  url: string;
  status: Status;
  httpCode?: number;
  error?: string;
  timeMs: number;
}

export interface CheckOptions {
  timeoutMs: number;
  userAgent: string;
  method: "HEAD" | "GET";
  followRedirects: boolean;
  acceptCodes: number[]; // which codes count as "ok" even when not 2xx
}

const DEFAULTS: CheckOptions = {
  timeoutMs: 10_000,
  userAgent: "linkchk/0.1 (+https://github.com/f4rkh4d/linkchk)",
  method: "HEAD",
  followRedirects: true,
  acceptCodes: [200, 204, 301, 302, 303, 307, 308, 401, 403],
};

function isCheckable(url: string): boolean {
  // Skip non-http schemes and relative/anchor links.
  if (!/^https?:\/\//i.test(url)) return false;
  return true;
}

export async function checkOne(
  url: string,
  opts: Partial<CheckOptions> = {},
): Promise<CheckResult> {
  const o = { ...DEFAULTS, ...opts };
  const start = performance.now();

  if (!isCheckable(url)) {
    return { url, status: "skipped", timeMs: 0 };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs);

  try {
    let res = await fetch(url, {
      method: o.method,
      headers: { "user-agent": o.userAgent, accept: "*/*" },
      redirect: o.followRedirects ? "follow" : "manual",
      signal: ctrl.signal,
    });

    // Some servers return 405 on HEAD. Fall back to GET once.
    if (o.method === "HEAD" && (res.status === 405 || res.status === 501)) {
      res = await fetch(url, {
        method: "GET",
        headers: { "user-agent": o.userAgent, accept: "*/*" },
        redirect: o.followRedirects ? "follow" : "manual",
        signal: ctrl.signal,
      });
    }

    const timeMs = Math.round(performance.now() - start);
    const ok =
      (res.status >= 200 && res.status < 400) ||
      o.acceptCodes.includes(res.status);
    return {
      url,
      status: ok ? "ok" : "broken",
      httpCode: res.status,
      timeMs,
    };
  } catch (err: any) {
    const timeMs = Math.round(performance.now() - start);
    const msg =
      err?.name === "AbortError"
        ? "timeout"
        : err?.message ?? String(err);
    return { url, status: "error", error: msg, timeMs };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAll(
  urls: string[],
  concurrency: number,
  opts: Partial<CheckOptions> = {},
  onResult?: (r: CheckResult) => void,
): Promise<CheckResult[]> {
  const results: CheckResult[] = new Array(urls.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= urls.length) return;
      const r = await checkOne(urls[i]!, opts);
      results[i] = r;
      if (onResult) onResult(r);
    }
  }

  for (let i = 0; i < Math.max(1, concurrency); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
