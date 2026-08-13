import "./server-only";
import type { RankedRestaurant } from "./ranking";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-latest";
export const EXPLANATION_TIMEOUT_MS = 2500;

type Fetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

type ExplanationSelection = {
  reasonIndexes: number[];
  tone: "균형 추천" | "예산 추천";
};

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function generateDeterministicExplanation(recommendation: RankedRestaurant) {
  const { restaurant, score, reasons, estimate } = recommendation;
  const factualReasons = reasons.slice(0, 2).join(" ");
  const distance = restaurant.distanceMeters === null
    ? "거리 정보는 확인할 수 없어요."
    : `거리 ${restaurant.distanceMeters}m예요.`;
  return `${restaurant.name}은(는) ${score}점으로 추천됐어요. ${factualReasons} ${distance} 1인 예상 ${formatWon(estimate.perPerson.min)}~${formatWon(estimate.perPerson.max)}를 참고해 주세요.`;
}

function parseSelection(value: unknown, reasonCount: number): ExplanationSelection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExplanationSelection>;
  const tones: ExplanationSelection["tone"][] = ["균형 추천", "예산 추천"];
  if (!Array.isArray(candidate.reasonIndexes) || !candidate.reasonIndexes.length || !tones.includes(candidate.tone as ExplanationSelection["tone"])) {
    return null;
  }
  const uniqueIndexes = Array.from(new Set(candidate.reasonIndexes));
  if (uniqueIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= reasonCount)) return null;
  return { reasonIndexes: uniqueIndexes.slice(0, 2), tone: candidate.tone as ExplanationSelection["tone"] };
}

function explanationFromSelection(
  recommendation: RankedRestaurant,
  selection: ExplanationSelection,
) {
  const selectedReasons = selection.reasonIndexes.map((index) => recommendation.reasons[index]);
  return `${recommendation.restaurant.name}, ${selection.tone}이에요. ${selectedReasons.join(" ")}`;
}

export async function generateExplanation(
  recommendation: RankedRestaurant,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return generateDeterministicExplanation(recommendation);

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("OpenRouter explanation timed out"));
    }, EXPLANATION_TIMEOUT_MS);
  });

  try {
    const facts = {
      restaurantName: recommendation.restaurant.name,
      score: recommendation.score,
      perPersonEstimate: recommendation.estimate.perPerson,
      reasons: recommendation.reasons,
      ...(recommendation.restaurant.distanceMeters === null ? {} : {
        distanceMeters: recommendation.restaurant.distanceMeters,
      }),
    };
    const response = await Promise.race([
      fetcher(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
          temperature: 0,
          max_tokens: 100,
          messages: [
            {
              role: "system",
              content: "주어진 식당 사실이나 순위를 바꾸지 마세요. 제공된 추천 근거 중 최대 2개를 고르고 정해진 한국어 톤만 반환하세요.",
            },
            { role: "user", content: JSON.stringify(facts) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "restaurant_explanation_selection",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  reasonIndexes: { type: "array", minItems: 1, maxItems: 2, items: { type: "integer", minimum: 0 } },
                  tone: { type: "string", enum: ["균형 추천", "예산 추천"] },
                },
                required: ["reasonIndexes", "tone"],
                additionalProperties: false,
              },
            },
          },
        }),
      }),
      timeout,
    ]);
    if (!response.ok) throw new Error("OpenRouter explanation request failed");
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("OpenRouter returned no structured content");
    const selection = parseSelection(JSON.parse(content) as unknown, recommendation.reasons.length);
    if (!selection) throw new Error("OpenRouter returned invalid structured content");
    return explanationFromSelection(recommendation, selection);
  } catch {
    return generateDeterministicExplanation(recommendation);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
