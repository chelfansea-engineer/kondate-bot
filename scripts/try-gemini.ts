/**
 * 本物のGemini APIを1回だけ呼んで、リクエストの形と出力の検証が通るかを確かめる。
 *
 *   GEMINI_API_KEY=<キー> GEMINI_MODEL=gemini-3.8-flash pnpm run try:gemini [気分]
 *
 * - APIを1回呼ぶ（キーの無料枠や料金を使う）。送るのは、下の見本の在庫と気分だけ。
 * - 本番と同じ関数（プロンプト、Geminiクライアント、検証、整形）を使う。
 * - .dev.vars は読まない。使うなら人間が:  node --env-file=.dev.vars scripts/try-gemini.ts
 */
import { generateJson } from "../src/clients/gemini.ts";
import {
  buildPrompt,
  formatReply,
  parseSuggestion,
  suggestionJsonSchema,
} from "../src/core/suggest.ts";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;
if (!apiKey || !model) {
  console.error(
    "GEMINI_API_KEY と GEMINI_MODEL が必要です。例: GEMINI_API_KEY=xxxx GEMINI_MODEL=gemini-3.8-flash pnpm run try:gemini",
  );
  process.exit(1);
}

const pantry = [
  { id: 1, name: "玉ねぎ", category: "food", memo: "2個", createdAt: "" },
  { id: 2, name: "卵", category: "food", memo: "6個", createdAt: "" },
  { id: 3, name: "豆腐", category: "food", memo: "", createdAt: "" },
  { id: 4, name: "醤油", category: "seasoning", memo: "", createdAt: "" },
  { id: 5, name: "味噌", category: "seasoning", memo: "", createdAt: "" },
] as const;
const meals = [
  { id: 1, name: "カレー", eatenOn: "2026-11-23", createdAt: "" },
  { id: 2, name: "豚の生姜焼き", eatenOn: "2026-11-22", createdAt: "" },
];
const message = process.argv[2] ?? "さっぱりしたい";

const prompt = buildPrompt({
  message,
  pantry: [...pantry],
  meals,
  today: "2026-11-24",
});
const startedAt = Date.now();
try {
  const raw = await generateJson({
    apiKey,
    model,
    system: prompt.system,
    user: prompt.user,
    schema: suggestionJsonSchema(),
  });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const suggestion = parseSuggestion(raw);
  if (suggestion) {
    console.log(`OK  検証に成功（${seconds}秒、モデル ${model}）\n`);
    console.log(formatReply(suggestion));
  } else {
    console.error(`NG  検証に失敗（${seconds}秒）。Geminiの返事:`);
    console.error(JSON.stringify(raw, null, 2));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    `NG  ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
