import { listMeals, listPantryItems } from "../clients/d1";
import { generateJson } from "../clients/gemini";
import { replyMessage } from "../clients/line";
import { jstDate, recentSince } from "../core/meals";
import {
  buildPrompt,
  EMPTY_PANTRY_REPLY,
  FAILURE_REPLY,
  formatReply,
  parseSuggestion,
  suggestionJsonSchema,
} from "../core/suggest";
import type { Env } from "../env";

const SCHEMA = suggestionJsonSchema();

/**
 * ユーザーの在庫・最近の食事と、気分・希望から、返信の文面を作る。
 * 失敗しても例外は投げず、お詫びの文面を返す。
 */
export async function suggestionText(
  env: Env,
  userId: string,
  message: string,
): Promise<string> {
  try {
    const today = jstDate(new Date());
    const [pantry, meals] = await Promise.all([
      listPantryItems(env.DB, userId),
      listMeals(env.DB, userId, recentSince(today)),
    ]);
    // 在庫がなければ、Geminiを呼ばない
    if (pantry.length === 0) return EMPTY_PANTRY_REPLY;

    const prompt = buildPrompt({ message, pantry, meals, today });
    const raw = await generateJson({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
      system: prompt.system,
      user: prompt.user,
      schema: SCHEMA,
    });
    const suggestion = parseSuggestion(raw);
    if (!suggestion) {
      console.error("Gemini output failed schema validation");
      return FAILURE_REPLY;
    }
    return formatReply(suggestion);
  } catch (error) {
    console.error(error);
    return FAILURE_REPLY;
  }
}

export type TextEvent = {
  replyToken: string;
  /** Webhookの署名検証を通ったイベントの送信者 */
  userId: string;
  text: string;
};

/** 提案を作って、Reply API で返す */
export async function replyWithSuggestion(
  env: Env,
  event: TextEvent,
): Promise<void> {
  const text = await suggestionText(env, event.userId, event.text);
  try {
    await replyMessage(event.replyToken, text, env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error(error);
  }
}
