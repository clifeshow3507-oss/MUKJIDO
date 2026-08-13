import type { PriceRange, RecommendationInput, RestaurantCandidate } from "./domain";

export type CostEstimate = {
  food: PriceRange;
  alcohol: PriceRange;
  perPerson: PriceRange;
  total: PriceRange;
  disclaimer: string;
};

const CATEGORY_PRICE_BANDS: Record<string, PriceRange> = {
  "한식": { min: 24000, max: 32000 },
  "고기": { min: 28000, max: 38000 },
  "일식": { min: 26000, max: 36000 },
  "중식": { min: 22000, max: 30000 },
  "양식": { min: 25000, max: 35000 },
  "해산물": { min: 30000, max: 42000 },
  "분식": { min: 12000, max: 18000 },
  "korean": { min: 24000, max: 32000 },
  "meat": { min: 28000, max: 38000 },
  "japanese": { min: 26000, max: 36000 },
  "chinese": { min: 22000, max: 30000 },
  "western": { min: 25000, max: 35000 },
  "seafood": { min: 30000, max: 42000 },
};

const DEFAULT_FOOD_PRICE: PriceRange = { min: 22000, max: 32000 };

const ALCOHOL_PRICE_BANDS: Record<string, PriceRange> = {
  "소주": { min: 5000, max: 6000 },
  "맥주": { min: 6000, max: 8000 },
  "와인": { min: 10000, max: 15000 },
  "전통주": { min: 5000, max: 7000 },
  "칵테일": { min: 11000, max: 16000 },
  soju: { min: 5000, max: 6000 },
  beer: { min: 6000, max: 8000 },
  wine: { min: 10000, max: 15000 },
  makgeolli: { min: 5000, max: 7000 },
  cocktail: { min: 11000, max: 16000 },
};

const ALCOHOL_LEVEL_MULTIPLIERS: Record<string, number> = {
  "가볍게": 1,
  "보통": 1.7,
  "많이": 2.5,
  light: 1,
  normal: 1.7,
  heavy: 2.5,
};

export const COST_ESTIMATE_DISCLAIMER =
  "예상 금액이며 실제 메뉴 가격은 매장과 주문에 따라 달라질 수 있으니 방문 전 가격을 확인하세요.";

function isNoAlcohol(level: string) {
  return ["안마심", "안 마심", "none", "no alcohol"].includes(level.trim().toLowerCase());
}

function averageRange(ranges: PriceRange[]): PriceRange {
  if (ranges.length === 0) return ALCOHOL_PRICE_BANDS["소주"];

  return {
    min: Math.round(ranges.reduce((sum, range) => sum + range.min, 0) / ranges.length),
    max: Math.round(ranges.reduce((sum, range) => sum + range.max, 0) / ranges.length),
  };
}

function foodPriceFor(restaurant: RestaurantCandidate): PriceRange {
  return restaurant.estimatedFoodPerPerson ?? CATEGORY_PRICE_BANDS[restaurant.category.toLowerCase()] ?? DEFAULT_FOOD_PRICE;
}

export function estimateCost(
  input: RecommendationInput,
  restaurant: RestaurantCandidate,
): CostEstimate {
  const food = foodPriceFor(restaurant);
  const alcoholRanges = input.alcoholTypes
    .map((type) => ALCOHOL_PRICE_BANDS[type.toLowerCase()])
    .filter((range): range is PriceRange => Boolean(range));
  const alcoholBase = averageRange(alcoholRanges);
  const multiplier = isNoAlcohol(input.alcoholLevel)
    ? 0
    : ALCOHOL_LEVEL_MULTIPLIERS[input.alcoholLevel.toLowerCase()] ?? 1.7;
  const alcohol = {
    min: Math.round(alcoholBase.min * multiplier),
    max: Math.round(alcoholBase.max * multiplier),
  };
  const perPerson = {
    min: food.min + alcohol.min,
    max: food.max + alcohol.max,
  };

  return {
    food: { min: food.min * input.headcount, max: food.max * input.headcount },
    alcohol: { min: alcohol.min * input.headcount, max: alcohol.max * input.headcount },
    perPerson,
    total: { min: perPerson.min * input.headcount, max: perPerson.max * input.headcount },
    disclaimer: COST_ESTIMATE_DISCLAIMER,
  };
}
