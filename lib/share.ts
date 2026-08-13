import type { RecommendationInput } from "./domain";

const OCCASIONS = new Set(["점심", "저녁", "회식", "거래처", "가족 모임"]);
const ATMOSPHERES = new Set(["조용한 대화", "활기찬 회식", "격식 있는 식사", "편안한 모임", "프라이빗"]);
const FOOD_PREFERENCES = new Set(["매운맛", "가벼운 식사", "고기", "해산물", "채식 배려", "새로운 음식"]);
const MENUS = new Set(["한식", "고기", "일식", "중식", "양식", "해산물", "분식", "상관없음"]);
const ALCOHOL_LEVELS = new Set(["안 마심", "안마심", "가볍게", "보통", "많이"]);
const ALCOHOL_TYPES = new Set(["소주", "맥주", "와인", "전통주", "위스키·하이볼"]);

export type SafeSharePayload = {
  version: 1;
  conditions: {
    locationMode: RecommendationInput["location"]["mode"];
    headcount: number;
    radiusMeters: number;
    occasion?: string;
    atmospheres: string[];
    foodPreferences: string[];
    menus: string[];
    budgetMode: RecommendationInput["budgetMode"];
    budgetBand: number;
    alcoholLevel?: string;
    alcoholTypes: string[];
  };
  restaurantIds: string[];
};

function permitted(values: string[], allowed: Set<string>) {
  return Array.from(new Set(values.filter((value) => allowed.has(value))));
}

function safeRestaurantIds(ids: string[]) {
  return Array.from(new Set(ids.filter((id) => /^[A-Za-z0-9_-]{1,80}$/.test(id)))).slice(0, 3);
}

export function createSharePayload(
  input: RecommendationInput,
  restaurantIds: string[],
): SafeSharePayload {
  return {
    version: 1,
    conditions: {
      locationMode: input.location.mode,
      headcount: Math.max(1, Math.min(50, Math.round(input.headcount))),
      radiusMeters: [500, 1000, 2000].includes(input.radiusMeters) ? input.radiusMeters : 1000,
      occasion: OCCASIONS.has(input.occasion) ? input.occasion : undefined,
      atmospheres: permitted(input.atmospheres, ATMOSPHERES),
      foodPreferences: permitted(input.foodPreferences, FOOD_PREFERENCES),
      menus: permitted(input.menus, MENUS),
      budgetMode: input.budgetMode,
      budgetBand: Math.max(0, Math.round(input.budgetAmount / 10000) * 10000),
      alcoholLevel: ALCOHOL_LEVELS.has(input.alcoholLevel) ? input.alcoholLevel : undefined,
      alcoholTypes: permitted(input.alcoholTypes, ALCOHOL_TYPES),
    },
    restaurantIds: safeRestaurantIds(restaurantIds),
  };
}

function encodePayload(payload: SafeSharePayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function createShareUrl(origin: string, payload: SafeSharePayload) {
  const url = new URL("/", origin);
  url.searchParams.set("share", encodePayload(payload));
  return url.toString();
}

export function canonicalizeSharePayload(value: unknown): SafeSharePayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (!payload.conditions || typeof payload.conditions !== "object" || !Array.isArray(payload.restaurantIds)) return null;
  const conditions = payload.conditions as Record<string, unknown>;
  const canonical: SafeSharePayload = {
    version: 1,
    conditions: {
      locationMode: conditions.locationMode as SafeSharePayload["conditions"]["locationMode"],
      headcount: conditions.headcount as number,
      radiusMeters: conditions.radiusMeters as number,
      ...(typeof conditions.occasion === "string" ? { occasion: conditions.occasion } : {}),
      atmospheres: Array.isArray(conditions.atmospheres) ? conditions.atmospheres.filter((item): item is string => typeof item === "string") : [],
      foodPreferences: Array.isArray(conditions.foodPreferences) ? conditions.foodPreferences.filter((item): item is string => typeof item === "string") : [],
      menus: Array.isArray(conditions.menus) ? conditions.menus.filter((item): item is string => typeof item === "string") : [],
      budgetMode: conditions.budgetMode as SafeSharePayload["conditions"]["budgetMode"],
      budgetBand: conditions.budgetBand as number,
      ...(typeof conditions.alcoholLevel === "string" ? { alcoholLevel: conditions.alcoholLevel } : {}),
      alcoholTypes: Array.isArray(conditions.alcoholTypes) ? conditions.alcoholTypes.filter((item): item is string => typeof item === "string") : [],
    },
    restaurantIds: payload.restaurantIds.filter((item): item is string => typeof item === "string"),
  };
  return isSafeSharePayload(canonical) ? canonical : null;
}

export function isSafeSharePayload(value: unknown): value is SafeSharePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<SafeSharePayload>;
  if (payload.version !== 1 || !payload.conditions || !Array.isArray(payload.restaurantIds)) return false;
  const conditions = payload.conditions as Partial<SafeSharePayload["conditions"]>;
  return (conditions.locationMode === "current" || conditions.locationMode === "search")
    && typeof conditions.headcount === "number" && conditions.headcount >= 1 && conditions.headcount <= 50
    && typeof conditions.radiusMeters === "number"
    && (conditions.occasion === undefined || OCCASIONS.has(conditions.occasion))
    && Array.isArray(conditions.atmospheres) && permitted(conditions.atmospheres, ATMOSPHERES).length === conditions.atmospheres.length
    && Array.isArray(conditions.foodPreferences) && permitted(conditions.foodPreferences, FOOD_PREFERENCES).length === conditions.foodPreferences.length
    && Array.isArray(conditions.menus) && permitted(conditions.menus, MENUS).length === conditions.menus.length
    && (conditions.budgetMode === "perPerson" || conditions.budgetMode === "total")
    && typeof conditions.budgetBand === "number" && conditions.budgetBand >= 0
    && (conditions.alcoholLevel === undefined || ALCOHOL_LEVELS.has(conditions.alcoholLevel))
    && Array.isArray(conditions.alcoholTypes) && permitted(conditions.alcoholTypes, ALCOHOL_TYPES).length === conditions.alcoholTypes.length
    && safeRestaurantIds(payload.restaurantIds).length === payload.restaurantIds.length;
}

export function restoreSharePayload(encoded: string | null): SafeSharePayload | null {
  if (!encoded || encoded.length > 4000) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SafeSharePayload>;
    return canonicalizeSharePayload(value);
  } catch {
    return null;
  }
}
