import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const SERVER_ONLY = ["data", "ai", "journal", "analysis", "server", "scanner", "autonomous"].map((d) => join(SRC, d));

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // package import
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && candidate.match(/\.(ts|tsx|css)$/)) return candidate;
  }
  return null;
}

/** Every source file the browser bundle can reach from the client entry point. */
function clientGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith(".css")) continue;
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/(?:import|export)[^'"]*?from\s*["']([^"']+)["']|import\s*\(?\s*["']([^"']+)["']/g)) {
      const target = resolveImport(file, m[1] ?? m[2]!);
      if (target) queue.push(target);
    }
  }
  return seen;
}

describe("client/server boundary", () => {
  const graph = clientGraph(join(SRC, "ui/main.tsx"));

  it("finds the client code", () => {
    expect(graph.size).toBeGreaterThan(20);
  });

  it("the browser bundle cannot reach data, AI, journal, analysis or server code", () => {
    const leaks = [...graph].filter((f) => SERVER_ONLY.some((dir) => f.startsWith(dir + "/")));
    expect(leaks).toEqual([]);
  });

  it("no client file reads process.env", () => {
    const offenders = [...graph].filter((f) => !f.endsWith(".css") && readFileSync(f, "utf8").includes("process.env"));
    expect(offenders).toEqual([]);
  });
});
