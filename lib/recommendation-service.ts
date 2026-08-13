import "./server-only";
import type {
  RecommendationApiResponse,
  RecommendationInput,
  RecommendationLabel,
  RecommendationResponseSource,
  RestaurantCandidate,
} from "./domain";
import { FALLBACK_RESTAURANTS } from "./fallback-restaurants";
import { generateDeterministicExplanation, generateExplanation } from "./explanation";
import { searchPublicRestaurants } from "./public-restaurant-search";
import type { PublicSearchPurpose } from "./public-restaurant-search";
import { rankRestaurants, type RankedRestaurant } from "./ranking";

type RecommendDependencies = {
  search?: (input: RecommendationInput, purpose?: PublicSearchPurpose) => Promise<RestaurantCandidate[]>;
  explain?: (recommendation: RankedRestaurant) => Promise<string>;
  fallbackCandidates?: readonly RestaurantCandidate[];
};

function secondRoundPurpose(occasion: string): Exclude<PublicSearchPurpose, "restaurant"> {
  return /저녁|회식|술|dinner|drinking/i.test(occasion) ? "secondRoundBar" : "cafe";
}

export type RecommendationBuildResponse = {
  status: number;
  body: RecommendationApiResponse | {
    ok: false;
    code: "INVALID_INPUT" | "SEARCH_FAILED";
    message: string;
    errors?: unknown;
  };
};

const LABELS: readonly RecommendationLabel[] = ["1순위", "안전한 선택", "색다른 선택"];
const MIXED_SOURCE_WARNING = "공개 검색 결과와 기본 목록을 함께 사용했어요.";
const FALLBACK_SOURCE_WARNING = "공개 검색 결과를 가져오지 못해 기본 목록으로 추천했어요. 실제 거리가 확인되지 않아 주소 기준 추천입니다.";
const UNKNOWN_DISTANCE_WARNING = "실제 거리가 확인되지 않은 식당은 주소 기준 추천입니다.";

function relaxationResponse(
  code: "ZERO_RESULTS" | "INSUFFICIENT_ELIGIBLE_CANDIDATES" | "INSUFFICIENT_ADVENTUROUS_DIVERSITY" | "DISTANCE_VERIFICATION_REQUIRED",
  eligibleCount: number,
  context: { source: RecommendationResponseSource; warnings: string[] } = { source: "public", warnings: [] },
): RecommendationBuildResponse {
  const diversity = code === "INSUFFICIENT_ADVENTUROUS_DIVERSITY";
  return {
    status: 422,
    body: {
      ok: false,
      code,
      eligibleCount,
      message: diversity
        ? "서로 다른 성격의 식당이 부족해요. 조건을 완화하거나 검색 반경을 넓혀 다시 찾아보세요."
        : "조건에 맞는 식당이 충분하지 않아 검색 반경을 넓히거나 일부 조건을 완화해 주세요.",
      suggestions: ["검색 반경 넓히기", "메뉴 조건 줄이기", "분위기 조건 줄이기"],
      source: context.source,
      warnings: context.warnings,
    },
  };
}

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s,.-]+/g, "");
}

function candidateKey(candidate: RestaurantCandidate): string {
  return `${normalized(candidate.name)}|${normalized(candidate.roadAddress ?? candidate.address)}`;
}

function uniqueCandidates(candidates: readonly RestaurantCandidate[]): RestaurantCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function orderedPublicCandidates(
  input: RecommendationInput,
  candidates: readonly RestaurantCandidate[],
): RestaurantCandidate[] {
  const publicCandidates = candidates.map((candidate) => ({ ...candidate, source: "public" as const }));
  return uniqueCandidates([
    ...publicCandidates.filter((candidate) => candidate.distanceMeters !== null && candidate.distanceMeters <= input.radiusMeters),
    ...publicCandidates.filter((candidate) => candidate.distanceMeters === null),
  ]);
}

function orderedFallbackCandidates(
  input: RecommendationInput,
  candidates: readonly RestaurantCandidate[],
): RestaurantCandidate[] {
  return uniqueCandidates(candidates
    .filter((candidate) => candidate.distanceMeters === null || candidate.distanceMeters <= input.radiusMeters)
    .map((candidate) => ({ ...candidate, source: "fallback" as const })));
}

function sourceFor(candidates: readonly RankedRestaurant[]): RecommendationResponseSource {
  const sources = new Set(candidates.map(({ restaurant }) => restaurant.source));
  if (sources.has("public") && sources.has("fallback")) return "mixed";
  return sources.has("fallback") ? "fallback" : "public";
}

function warningsFor(source: RecommendationResponseSource, candidates: readonly RankedRestaurant[]): string[] {
  if (source === "mixed") {
    const warnings = [MIXED_SOURCE_WARNING];
    if (candidates.some(({ restaurant }) => restaurant.distanceMeters === null)) warnings.push(UNKNOWN_DISTANCE_WARNING);
    return warnings;
  }
  if (source === "fallback") return [FALLBACK_SOURCE_WARNING];
  return candidates.some(({ restaurant }) => restaurant.distanceMeters === null) ? [UNKNOWN_DISTANCE_WARNING] : [];
}

export async function buildRecommendationResponse(
  input: RecommendationInput,
  dependencies: RecommendDependencies = {},
): Promise<RecommendationBuildResponse> {
  const search = dependencies.search
    ?? ((searchInput: RecommendationInput, purpose: PublicSearchPurpose = "restaurant") => (
      searchPublicRestaurants(searchInput, fetch, purpose)
    ));
  const explain = dependencies.explain ?? generateExplanation;
  let publicCandidates: RestaurantCandidate[] = [];

  try {
    publicCandidates = await search(input);
  } catch {
    publicCandidates = [];
  }

  const publicOrdered = orderedPublicCandidates(input, publicCandidates);
  let ranked = rankRestaurants(input, publicOrdered);
  let attemptedCandidates = publicOrdered;

  if (!ranked.ok) {
    attemptedCandidates = uniqueCandidates([
      ...publicOrdered,
      ...orderedFallbackCandidates(input, dependencies.fallbackCandidates ?? FALLBACK_RESTAURANTS),
    ]);
    ranked = rankRestaurants(input, attemptedCandidates);
  }

  const attemptedSource: RecommendationResponseSource = publicOrdered.length === 0
    ? "fallback"
    : attemptedCandidates.some((candidate) => candidate.source === "fallback") ? "mixed" : "public";
  if (!ranked.ok) return relaxationResponse(ranked.code, ranked.eligibleCount, {
    source: attemptedSource,
    warnings: attemptedSource === "fallback" ? [FALLBACK_SOURCE_WARNING] : attemptedSource === "mixed" ? [MIXED_SOURCE_WARNING] : [],
  });

  const ordered = [ranked.best, ranked.safe, ranked.adventurous];
  const source = sourceFor(ordered);
  const explanations = await Promise.all(ordered.map(async (recommendation) => {
    try {
      const explanation = await explain(recommendation);
      return typeof explanation === "string" && explanation.trim()
        ? explanation
        : generateDeterministicExplanation(recommendation);
    } catch {
      return generateDeterministicExplanation(recommendation);
    }
  }));

  let secondRoundRecommendations: RestaurantCandidate[] | undefined;
  if (input.includeSecondRound !== false) {
    const firstRestaurant = ordered[0].restaurant;
    const hasFirstCoordinates = typeof firstRestaurant.latitude === "number"
      && Number.isFinite(firstRestaurant.latitude)
      && typeof firstRestaurant.longitude === "number"
      && Number.isFinite(firstRestaurant.longitude);
    const searchOrigin: NonNullable<RestaurantCandidate["searchOrigin"]> = hasFirstCoordinates
      ? "firstRecommendation"
      : "input";
    const secondRoundInput: RecommendationInput = hasFirstCoordinates
      ? {
        ...input,
        location: {
          mode: "current",
          latitude: firstRestaurant.latitude,
          longitude: firstRestaurant.longitude,
        },
      }
      : input;
    try {
      const firstRoundKeys = new Set(ordered.map(({ restaurant }) => candidateKey(restaurant)));
      const candidates = uniqueCandidates(await search(secondRoundInput, secondRoundPurpose(input.occasion)))
        .filter((candidate) => !firstRoundKeys.has(candidateKey(candidate)))
        .slice(0, 3)
        .map((candidate) => ({ ...candidate, searchOrigin }));
      if (candidates.length > 0) secondRoundRecommendations = candidates;
    } catch {
      secondRoundRecommendations = undefined;
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      source,
      warnings: warningsFor(source, ordered),
      ...(secondRoundRecommendations ? { secondRoundRecommendations } : {}),
      recommendations: ordered.map((recommendation, index) => ({
        label: LABELS[index],
        ...recommendation,
        explanation: explanations[index],
      })),
    },
  };
}
