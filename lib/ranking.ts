import { estimateCost, type CostEstimate } from "./estimate";
import type { RecommendationInput, RestaurantCandidate } from "./domain";

export type RankedRestaurant = {
  restaurant: RestaurantCandidate;
  score: number;
  reasons: string[];
  estimate: CostEstimate;
};

export type RecommendationSuccess = {
  ok: true;
  best: RankedRestaurant;
  safe: RankedRestaurant;
  adventurous: RankedRestaurant;
};

export type RecommendationFailure = {
  ok: false;
  code: "INSUFFICIENT_ELIGIBLE_CANDIDATES";
  eligibleCount: number;
};

export type RecommendationDiversityFailure = {
  ok: false;
  code: "INSUFFICIENT_ADVENTUROUS_DIVERSITY";
  eligibleCount: number;
};

export type RecommendationSet =
  | RecommendationSuccess
  | RecommendationFailure
  | RecommendationDiversityFailure;

function overlapCount(requested: string[], available: string[]) {
  return requested.filter((value) => available.includes(value)).length;
}

function perPersonBudget(input: RecommendationInput) {
  return input.budgetMode === "perPerson"
    ? input.budgetAmount
    : Math.floor(input.budgetAmount / input.headcount);
}

function scoreAlcohol(input: RecommendationInput, restaurant: RestaurantCandidate) {
  if (["안마심", "안 마심", "none", "no alcohol"].includes(input.alcoholLevel.toLowerCase())) {
    return 4;
  }
  if (!restaurant.alcoholTypes || restaurant.alcoholTypes.length === 0) return 3;
  return Math.min(6, overlapCount(input.alcoholTypes, restaurant.alcoholTypes) * 3);
}

function makeReasons(
  input: RecommendationInput,
  restaurant: RestaurantCandidate,
  estimate: CostEstimate,
): string[] {
  const reasons: string[] = [];
  if (restaurant.distanceMeters !== null && restaurant.distanceMeters <= input.radiusMeters) {
    reasons.push(`검색 반경 안 ${restaurant.distanceMeters}m 거리에 있습니다.`);
  }
  if (input.menus.includes(restaurant.category) || overlapCount(input.menus, restaurant.menus) > 0) {
    reasons.push(`${restaurant.category} 메뉴 조건과 잘 맞습니다.`);
  }
  if (restaurant.occasions.includes(input.occasion)) {
    reasons.push(`${input.occasion} 모임에 어울리는 분위기입니다.`);
  }
  if (overlapCount(input.atmospheres, restaurant.atmospheres) > 0) {
    reasons.push("원하는 자리 분위기를 반영했습니다.");
  }
  if (overlapCount(input.foodPreferences, restaurant.foodPreferences) > 0) {
    reasons.push("음식 취향에 맞는 선택지입니다.");
  }
  if (estimate.perPerson.max <= perPersonBudget(input)) {
    reasons.push("예산 범위 안의 예상 금액입니다.");
  } else {
    reasons.push("예산을 넘길 수 있어 주문 전 메뉴 확인이 필요합니다.");
  }
  if (reasons.length === 0) reasons.push("선택한 조건과 예산 범위를 고려한 추천입니다.");
  return reasons;
}

function rankOne(input: RecommendationInput, restaurant: RestaurantCandidate): RankedRestaurant {
  const estimate = estimateCost(input, restaurant);
  const distanceScore = restaurant.distanceMeters === null ? 0 : Math.max(
    0,
    30 - Math.round((restaurant.distanceMeters / Math.max(1, input.radiusMeters)) * 20),
  );
  const menuScore = (input.menus.includes(restaurant.category) ? 8 : 0) + overlapCount(input.menus, restaurant.menus) * 4;
  const occasionScore = restaurant.occasions.includes(input.occasion) ? 8 : 0;
  const atmosphereScore = overlapCount(input.atmospheres, restaurant.atmospheres) * 4;
  const preferenceScore = overlapCount(input.foodPreferences, restaurant.foodPreferences) * 4;
  const budget = perPersonBudget(input);
  const budgetScore = estimate.perPerson.max <= budget
    ? 18
    : -Math.min(30, Math.ceil((estimate.perPerson.max - budget) / 1000));
  const score = distanceScore + menuScore + occasionScore + atmosphereScore + preferenceScore + budgetScore + scoreAlcohol(input, restaurant);

  return { restaurant, score, reasons: makeReasons(input, restaurant, estimate), estimate };
}

function differsInCharacter(first: RankedRestaurant, second: RankedRestaurant) {
  return first.restaurant.category !== second.restaurant.category
    || first.restaurant.atmospheres.join("|") !== second.restaurant.atmospheres.join("|");
}

export function rankRestaurants(
  input: RecommendationInput,
  candidates: RestaurantCandidate[],
): RecommendationSet {
  const uniqueEligible = Array.from(
    new Map(
      candidates
        .filter((candidate) => candidate.isEligible !== false)
        .map((candidate) => [candidate.id, candidate]),
    ).values(),
  );

  if (uniqueEligible.length < 3) {
    return {
      ok: false,
      code: "INSUFFICIENT_ELIGIBLE_CANDIDATES",
      eligibleCount: uniqueEligible.length,
    };
  }

  const ranked = uniqueEligible
    .map((candidate) => rankOne(input, candidate))
    .sort((left, right) => right.score - left.score || left.restaurant.id.localeCompare(right.restaurant.id));
  const best = ranked[0];
  const safe = ranked[1];
  const adventurous = ranked.find(
    (candidate) => candidate !== best && candidate !== safe && differsInCharacter(best, candidate),
  );

  if (!adventurous) {
    return {
      ok: false,
      code: "INSUFFICIENT_ADVENTUROUS_DIVERSITY",
      eligibleCount: uniqueEligible.length,
    };
  }

  return { ok: true, best, safe, adventurous };
}
