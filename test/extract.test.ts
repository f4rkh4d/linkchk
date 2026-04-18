import { expect, test, describe } from "bun:test";
import { extractLinks, detectFormat } from "../src/extract";

describe("markdown extraction", () => {
  test("inline links", () => {
    const links = extractLinks(
      "see [docs](https://example.com/docs) and [api](http://api.example.com).",
    );
    expect(links.map((l) => l.url)).toEqual([
      "https://example.com/docs",
      "http://api.example.com",
    ]);
  });

  test("inline link with title", () => {
    const links = extractLinks(`check [this](https://example.com "homepage")`);
    expect(links[0]!.url).toBe("https://example.com");
  });

  test("image links", () => {
    const links = extractLinks(`![alt](https://img.example.com/pic.png)`);
    expect(links[0]!.url).toBe("https://img.example.com/pic.png");
  });

  test("autolinks", () => {
    const links = extractLinks(`visit <https://example.com> and <https://x.com>`);
    expect(links.map((l) => l.url)).toEqual([
      "https://example.com",
      "https://x.com",
    ]);
  });

  test("reference definitions", () => {
    const links = extractLinks(
      `see [docs][d]\n\n[d]: https://example.com/docs "title"`,
    );
    expect(links.some((l) => l.url === "https://example.com/docs")).toBe(true);
  });

  test("skips urls inside fenced code blocks", () => {
    const text = [
      "text before",
      "",
      "```",
      "curl https://should-be-skipped.example.com/api",
      "```",
      "",
      "text after with [real link](https://included.example.com)",
    ].join("\n");
    const urls = extractLinks(text).map((l) => l.url);
    expect(urls).toContain("https://included.example.com");
    expect(urls).not.toContain("https://should-be-skipped.example.com/api");
  });

  test("skips urls inside inline code", () => {
    const text = "try `curl https://nope.example.com` or [yep](https://yep.example.com)";
    const urls = extractLinks(text).map((l) => l.url);
    expect(urls).toContain("https://yep.example.com");
    expect(urls).not.toContain("https://nope.example.com");
  });

  test("dedupes same url on same line", () => {
    const text = `[a](https://example.com) [b](https://example.com)`;
    // Different MD_INLINE matches but same url+line => deduped.
    const links = extractLinks(text);
    expect(links.length).toBe(1);
  });

  test("tracks line numbers", () => {
    const text = `line 1\nline 2 [x](https://example.com)\nline 3`;
    const [link] = extractLinks(text);
    expect(link!.line).toBe(2);
  });
});

describe("html extraction", () => {
  test("a href double quotes", () => {
    const links = extractLinks(`<a href="https://example.com">go</a>`, "html");
    expect(links[0]!.url).toBe("https://example.com");
  });

  test("a href single quotes", () => {
    const links = extractLinks(`<a href='https://example.com'>go</a>`, "html");
    expect(links[0]!.url).toBe("https://example.com");
  });

  test("img src", () => {
    const links = extractLinks(
      `<img src="https://img.example.com/a.png" alt="">`,
      "html",
    );
    expect(links[0]!.url).toBe("https://img.example.com/a.png");
  });

  test("script src", () => {
    const links = extractLinks(
      `<script src="https://cdn.example.com/x.js"></script>`,
      "html",
    );
    expect(links[0]!.url).toBe("https://cdn.example.com/x.js");
  });

  test("link href in head", () => {
    const links = extractLinks(
      `<link rel="stylesheet" href="https://css.example.com/s.css">`,
      "html",
    );
    expect(links[0]!.url).toBe("https://css.example.com/s.css");
  });
});

describe("format detection", () => {
  test("detects html via doctype", () => {
    expect(detectFormat(`<!doctype html>\n<html><body></body></html>`)).toBe("html");
  });

  test("detects html via html tag", () => {
    expect(detectFormat(`<html lang="en"><head></head></html>`)).toBe("html");
  });

  test("defaults to md", () => {
    expect(detectFormat(`# hello\n\nsome markdown`)).toBe("md");
  });
});

describe("mixed content", () => {
  test("markdown with embedded html block", () => {
    const text = [
      "# doc",
      "",
      'regular [md link](https://md.example.com)',
      "",
      '<p><a href="https://html.example.com">html link</a></p>',
    ].join("\n");
    const urls = extractLinks(text).map((l) => l.url);
    expect(urls).toContain("https://md.example.com");
    expect(urls).toContain("https://html.example.com");
  });
});
