# linkchk

[![npm](https://img.shields.io/npm/v/linkchk.svg)](https://www.npmjs.com/package/linkchk)
[![CI](https://github.com/f4rkh4d/linkchk/actions/workflows/ci.yml/badge.svg)](https://github.com/f4rkh4d/linkchk/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

fast parallel link checker for markdown and html. built with bun. ci-friendly.

```bash
linkchk README.md
```

```
✓  200      https://github.com/f4rkh4d/linkchk  (README.md:4)
✓  200      https://example.com                 (README.md:12)
✗  404      https://old-link.example/gone       (README.md:18)
✗  timeout  https://slow-server.test            (README.md:23)

31 ok, 1 broken, 1 errored, 0 skipped  (of 33)
```

exits non-zero if anything's broken. drop it in ci and forget it.

## why

- existing tools for this are slow (serial fetches) or heavy (selenium, puppeteer)
- linkchk does concurrent `HEAD` requests, falls back to `GET` when servers 405
- handles markdown inline, reference, autolink, image syntax + raw html `<a>`, `<img>`, `<link>`, `<script>`
- skips urls inside code fences and inline code (so ur bash examples dont get pinged)
- single binary compile via `bun build --compile`. no node setup on the ci runner

## install

```bash
npm i -g linkchk
# or
bun add -g linkchk
```

needs bun or node 20+.

## usage

```bash
# one file
linkchk README.md

# multiple / glob (your shell expands it)
linkchk docs/**/*.md

# stdin
cat README.md | linkchk --stdin

# skip stuff
linkchk README.md --ignore 'localhost' --ignore 'example\.com'

# tune parallelism + timeout
linkchk README.md --concurrency 32 --timeout 5

# machine-readable
linkchk README.md --json > report.json

# show passing links too
linkchk README.md --show-ok
```

## options

| flag | default | what it does |
| --- | --- | --- |
| `--concurrency N` | 16 | parallel requests |
| `--timeout S` | 10 | seconds per request |
| `--ignore PATTERN` |. | regex to skip urls (repeatable) |
| `--json` | off | json output for tooling |
| `--show-ok` | off | include ok urls in output |
| `--stdin` | off | read from stdin |
| `-h`, `--help` |. | show help |
| `-V`, `--version` |. | show version |

## exit codes

- **0**. every link is ok
- **1**. at least one broken or errored
- **2**. bad flags / unreadable file

## what counts as "ok"

`2xx`, `3xx` redirects, and `401`/`403` (the url exists, it just requires auth. not your problem).

anything `4xx`/`5xx` outside that list = broken. network errors and timeouts = errored.

## use in ci

```yaml
# .github/workflows/link-check.yml
name: link check
on:
  push:
  schedule:
    - cron: "0 9 * * 1"   # every monday 9am
jobs:
  links:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun add -g linkchk
      - run: linkchk README.md docs/**/*.md
```

## dev

```bash
git clone https://github.com/f4rkh4d/linkchk
cd linkchk
bun install
bun test
```

## license

mit.
