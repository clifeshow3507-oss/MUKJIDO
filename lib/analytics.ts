import "./server-only";

import type { RecommendationInput } from "./domain";

const OCCASIONS = new Set(["점심", "데이트", "회식", "거래처", "가족 모임"]);
const ATMOSPHERES = new Set(["조용한 대화", "활기찬 회식", "격식 있는 식사", "편안한 모임", "프라이빗"]);
const FOOD_PREFERENCES = new Set(["매운맛", "가벼운 식사", "고기", "해산물", "채식 배려", "혼밥/간단 식사"]);
const MENUS = new Set(["한식", "고기", "일식", "중식", "양식", "해산물", "분식", "상관 없음"]);
const ALCOHOL_LEVELS = new Set(["안 마심", "안마심", "가볍게", "보통", "많이"]);
const ALCOHOL_TYPES = new Set(["소주", "맥주", "와인", "전통주", "위스키/하이볼"]);

const ANALYTICS_TIMEOUT_MS = 250;

type HeadcountBucket = "1" | "2-3" | "4-6" | "7+";
type BudgetBucket = "under-30000" | "30000-49999" | "50000-79999" | "80000+";
type ResultSource = "kakao" | "fallback" | "unknown";
type AnalyticsOutcome = "recommended" | "relaxed" | "failed";

type AnalyticsRecommendationResult = {
  ok: boolean;
  source?: unknown;
  code?: unknown;
  recommendations?: unknown;
};

export type AnonymousRecommendationEvent = {
  occasion?: string;
  atmospheres: string[];
  foodPreferences: string[];
  menus: string[];
  headcountBucket: HeadcountBucket;
  budgetBucket: BudgetBucket;
  alcoholLevel?: string;
  alcoholTypes: string[];
  restaurantIds: string[];
  resultSource: ResultSource;
  outcome: AnalyticsOutcome;
};

export type AnalyticsClient = {
  insert(event: AnonymousRecommendationEvent, signal: AbortSignal): Promise<void>;
};

function permitted(values: unknown, allowed: Set<string>) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && allowed.has(value))));
}

function safeRestaurantIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id)))).slice(0, 3);
}

function headcountBucket(value: number): HeadcountBucket {
  if (value <= 1) return "1";
  if (value <= 3) return "2-3";
  if (value <= 6) return "4-6";
  return "7+";
}

function budgetBucket(value: number): BudgetBucket {
  if (value < 30000) return "under-30000";
  if (value < 50000) return "30000-49999";
  if (value < 80000) return "50000-79999";
  return "80000+";
}

function eventOutcome(result: AnalyticsRecommendationResult): AnalyticsOutcome {
  if (result.ok) return "recommended";
  return result.source === "kakao" || result.source === "fallback"
    ? "relaxed"
    : "failed";
}

export function createAnonymousRecommendationEvent(
  input: RecommendationInput,
  result: AnalyticsRecommendationResult,
): AnonymousRecommendationEvent {
  const perPersonBudget = input.budgetMode === "perPerson"
    ? input.budgetAmount
    : input.budgetAmount / Math.max(input.headcount, 1);

  return sanitizeAnonymousEvent({
    occasion: input.occasion,
    atmospheres: input.atmospheres,
    foodPreferences: input.foodPreferences,
    menus: input.menus,
    headcountBucket: headcountBucket(input.headcount),
    budgetBucket: budgetBucket(perPersonBudget),
    alcoholLevel: input.alcoholLevel,
    alcoholTypes: input.alcoholTypes,
    restaurantIds: safeRestaurantIds(result.ok && Array.isArray(result.recommendations)
      ? result.recommendations.map((recommendation) => {
        if (!recommendation || typeof recommendation !== "object") return undefined;
        const restaurant = (recommendation as { restaurant?: unknown }).restaurant;
        return restaurant && typeof restaurant === "object"
          ? (restaurant as { id?: unknown }).id
          : undefined;
      })
      : []),
    resultSource: result.source === "kakao" || result.source === "fallback" ? result.source : "unknown",
    outcome: eventOutcome(result),
  });
}

function sanitizeAnonymousEvent(event: AnonymousRecommendationEvent): AnonymousRecommendationEvent {
  return {
    occasion: OCCASIONS.has(event.occasion ?? "") ? event.occasion : undefined,
    atmospheres: permitted(event.atmospheres, ATMOSPHERES),
    foodPreferences: permitted(event.foodPreferences, FOOD_PREFERENCES),
    menus: permitted(event.menus, MENUS),
    headcountBucket: ["1", "2-3", "4-6", "7+"].includes(event.headcountBucket) ? event.headcountBucket : "7+",
    budgetBucket: ["under-30000", "30000-49999", "50000-79999", "80000+"].includes(event.budgetBucket) ? event.budgetBucket : "80000+",
    alcoholLevel: ALCOHOL_LEVELS.has(event.alcoholLevel ?? "") ? event.alcoholLevel : undefined,
    alcoholTypes: permitted(event.alcoholTypes, ALCOHOL_TYPES),
    restaurantIds: safeRestaurantIds(event.restaurantIds),
    resultSource: event.resultSource === "kakao" || event.resultSource === "fallback" ? event.resultSource : "unknown",
    outcome: event.outcome === "recommended" || event.outcome === "relaxed" ? event.outcome : "failed",
  };
}

function createSupabaseAnalyticsClient(): AnalyticsClient | undefined {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return undefined;

  return {
    async insert(event, signal) {
      const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/anonymous_recommendation_events`, {
        method: "POST",
        signal,
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
          prefer: "return=minimal",
        },
        body: JSON.stringify({
          occasion: event.occasion ?? null,
          atmospheres: event.atmospheres,
          food_preferences: event.foodPreferences,
          menus: event.menus,
          headcount_bucket: event.headcountBucket,
          budget_bucket: event.budgetBucket,
          alcohol_level: event.alcoholLevel ?? null,
          alcohol_types: event.alcoholTypes,
          restaurant_ids: event.restaurantIds,
          result_source: event.resultSource,
          outcome: event.outcome,
        }),
      });
      if (!response.ok) throw new Error("Analytics insert failed");
    },
  };
}

export async function recordAnonymousEvent(
  event: AnonymousRecommendationEvent,
  client: AnalyticsClient | undefined = createSupabaseAnalyticsClient(),
): Promise<{ stored: boolean }> {
  if (!client) return { stored: false };

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const insert = client.insert(sanitizeAnonymousEvent(event), controller.signal);
    await Promise.race([
      insert,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Analytics insert timed out"));
        }, ANALYTICS_TIMEOUT_MS);
      }),
    ]);
    return { stored: true };
  } catch {
    console.warn("Anonymous analytics event was not stored.");
    return { stored: false };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
