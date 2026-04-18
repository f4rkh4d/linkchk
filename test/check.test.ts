import { expect, test, describe } from "bun:test";
import { checkOne, checkAll } from "../src/check";

// We use httpbin-like endpoints inline via a local Bun HTTP server so tests
// are deterministic and offline-friendly.

async function withServer<T>(
  handler: (req: Request) => Response | Promise<Response>,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = Bun.serve({ port: 0, fetch: handler });
  try {
    return await fn(`http://localhost:${server.port}`);
  } finally {
    server.stop(true);
  }
}

describe("checkOne", () => {
  test("200 is ok", async () => {
    await withServer(
      () => new Response("ok"),
      async (base) => {
        const r = await checkOne(`${base}/a`);
        expect(r.status).toBe("ok");
        expect(r.httpCode).toBe(200);
      },
    );
  });

  test("404 is broken", async () => {
    await withServer(
      () => new Response("nope", { status: 404 }),
      async (base) => {
        const r = await checkOne(`${base}/missing`);
        expect(r.status).toBe("broken");
        expect(r.httpCode).toBe(404);
      },
    );
  });

  test("401 is treated as ok (auth-gated, not broken)", async () => {
    await withServer(
      () => new Response("auth required", { status: 401 }),
      async (base) => {
        const r = await checkOne(`${base}/private`);
        expect(r.status).toBe("ok");
      },
    );
  });

  test("405 on HEAD falls back to GET", async () => {
    let sawGet = false;
    await withServer(
      (req) => {
        if (req.method === "HEAD")
          return new Response("no head", { status: 405 });
        sawGet = true;
        return new Response("ok");
      },
      async (base) => {
        const r = await checkOne(`${base}/x`);
        expect(r.status).toBe("ok");
        expect(sawGet).toBe(true);
      },
    );
  });

  test("timeout reported as error", async () => {
    await withServer(
      async () => {
        await new Promise((res) => setTimeout(res, 500));
        return new Response("too late");
      },
      async (base) => {
        const r = await checkOne(`${base}/slow`, { timeoutMs: 50 });
        expect(r.status).toBe("error");
        expect(r.error).toBe("timeout");
      },
    );
  });

  test("non-http url is skipped", async () => {
    const r = await checkOne("mailto:bennett@frkhd.com");
    expect(r.status).toBe("skipped");
  });

  test("relative url is skipped", async () => {
    const r = await checkOne("/local/path");
    expect(r.status).toBe("skipped");
  });
});

describe("checkAll concurrency", () => {
  test("returns one result per input in order", async () => {
    await withServer(
      () => new Response("ok"),
      async (base) => {
        const urls = [1, 2, 3, 4, 5].map((i) => `${base}/r/${i}`);
        const results = await checkAll(urls, 3);
        expect(results.length).toBe(5);
        for (let i = 0; i < 5; i++) {
          expect(results[i]!.url).toBe(urls[i]);
        }
      },
    );
  });

  test("respects concurrency limit", async () => {
    let inflight = 0;
    let peak = 0;
    await withServer(
      async () => {
        inflight++;
        peak = Math.max(peak, inflight);
        await new Promise((res) => setTimeout(res, 40));
        inflight--;
        return new Response("ok");
      },
      async (base) => {
        const urls = new Array(10).fill(null).map((_, i) => `${base}/c/${i}`);
        await checkAll(urls, 3);
        expect(peak).toBeLessThanOrEqual(3);
      },
    );
  });
});
