/**
 * docs/design.md と実物の突き合わせ。ステップ完了時に実行する。
 *
 *   pnpm run check:docs
 *
 * 見るもの:
 *   1. ファイル一覧   … src/ test/ scripts/ migrations/ の全ファイルが、第10章の表にあるか（逆も）
 *   2. モジュール依存図 … `%% check:deps` の図の矢印が、src/ の相対 import と一致するか
 *   3. ER図           … `%% check:er` の図の列が、migrations/ の CREATE TABLE と一致するか
 * 図の中身が正しいか（意味）までは見ない。それは人が読んで確かめる。
 */
import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";

const DESIGN = "docs/design.md";
const LISTED_DIRS = ["src", "test", "scripts", "migrations"];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return []; // .DS_Store など
    const path = posix.join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function diff(label: string, actual: Set<string>, documented: Set<string>) {
  const problems: string[] = [];
  for (const item of [...actual].sort()) {
    if (!documented.has(item))
      problems.push(`${label}: 設計書に無い → ${item}`);
  }
  for (const item of [...documented].sort()) {
    if (!actual.has(item)) problems.push(`${label}: 実物に無い → ${item}`);
  }
  return problems;
}

function mermaidBlock(doc: string, marker: string): string | null {
  const match = doc.match(
    new RegExp(`\`\`\`mermaid\\n%% ${marker}\\n([\\s\\S]*?)\`\`\``),
  );
  return match?.[1] ?? null;
}

const doc = readFileSync(DESIGN, "utf8");
const problems: string[] = [];

// 1. ファイル一覧
const actualFiles = new Set(LISTED_DIRS.flatMap(walk));
const documentedFiles = new Set(
  [...doc.matchAll(/^\| `((?:src|test|scripts|migrations)\/[^`]+)` \|/gm)].map(
    (m) => m[1] ?? "",
  ),
);
problems.push(...diff("ファイル一覧", actualFiles, documentedFiles));

// 2. モジュール依存図
const deps = mermaidBlock(doc, "check:deps");
if (deps === null) {
  problems.push("モジュール依存図: `%% check:deps` の図が見つからない");
} else {
  const idToPath = new Map(
    [...deps.matchAll(/(\w+)\["(src\/[^"]+?\.ts)[^"]*"\]/g)].map((m) => [
      m[1] ?? "",
      m[2] ?? "",
    ]),
  );
  const documentedEdges = new Set<string>();
  for (const m of deps.matchAll(/^\s*(\w+)\s*-->\s*(\w+)/gm)) {
    const from = idToPath.get(m[1] ?? "");
    const to = idToPath.get(m[2] ?? "");
    if (!from || !to) {
      problems.push(`モジュール依存図: 未定義のノード → ${m[1]} --> ${m[2]}`);
      continue;
    }
    documentedEdges.add(`${from} --> ${to}`);
  }

  const actualEdges = new Set<string>();
  for (const file of actualFiles) {
    if (!file.startsWith("src/") || !file.endsWith(".ts")) continue;
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/from "(\.[^"]+)"/g)) {
      const target = `${posix.normalize(posix.join(posix.dirname(file), m[1] ?? ""))}.ts`;
      actualEdges.add(`${file} --> ${target}`);
    }
  }
  problems.push(...diff("モジュール依存図", actualEdges, documentedEdges));
  for (const path of idToPath.values()) {
    if (!actualFiles.has(path)) {
      problems.push(`モジュール依存図: 実物に無いファイル → ${path}`);
    }
  }
}

// 3. ER図
const er = mermaidBlock(doc, "check:er");
if (er === null) {
  problems.push("ER図: `%% check:er` の図が見つからない");
} else {
  const documented = new Set<string>();
  for (const m of er.matchAll(/^\s*(\w+)\s*\{([\s\S]*?)\}/gm)) {
    for (const line of (m[2] ?? "").split("\n")) {
      const column = line.trim().split(/\s+/)[1];
      if (column) documented.add(`${m[1]}.${column}`);
    }
  }

  const actual = new Set<string>();
  for (const file of [...actualFiles].filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(file, "utf8");
    if (/ALTER TABLE/i.test(sql)) {
      problems.push(
        `ER図: ${file} に ALTER TABLE がある。このスクリプトは未対応なので拡張する`,
      );
    }
    for (const m of sql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
      for (const line of (m[2] ?? "").split("\n")) {
        const column = line.trim().split(/\s+/)[0];
        if (
          column &&
          !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)$/i.test(column)
        ) {
          actual.add(`${m[1]}.${column}`);
        }
      }
    }
  }
  problems.push(...diff("ER図", actual, documented));
}

if (problems.length > 0) {
  console.error(`${DESIGN} と実物がずれています:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `OK  ${DESIGN} は実物と一致（ファイル${actualFiles.size}件、依存図、ER図）`,
);
