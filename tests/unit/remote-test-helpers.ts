/**
 * Shared scaffolding for User Story 3's remote-* test files
 * (tests/unit/remote-fetch.test.ts and siblings) — a fresh, disposable
 * on-disk cache directory per test, so `DocumentCache`'s real
 * filesystem reads/writes (v0.2 FR-016 requires an actual on-disk cache,
 * not an in-memory stand-in) never collide between tests and never leak
 * into the repository. Every directory this creates lives under
 * `.cascata-cache/` at the repo root — already `.gitignore`d (T003) —
 * so nothing here needs its own gitignore entry.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh empty directory under the OS temp dir, unique per call — a real `cacheDir` for `resolve()`, deliberately outside the repository (unlike `.cascata-cache/`) so a test never needs cleanup coordination with other test files running in parallel. */
export function makeTempCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "cascata-cache-test-"));
}

/** Best-effort removal of a directory created by `makeTempCacheDir` — not load-bearing for correctness (OS temp dirs are reclaimed eventually regardless), just tidiness. */
export function removeTempCacheDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
