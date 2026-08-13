export type RecommendationLocation =
  | { mode: "current"; latitude?: number; longitude?: number }
  | { mode: "search"; query: string };

export type RecommendationInput = {
  location: RecommendationLocation;
  headcount: number;
  radiusMeters: number;
  occasion: string;
  atmospheres: string[];
  foodPreferences: string[];
  menus: string[];
  budgetMode: "perPerson" | "total";
  budgetAmount: number;
  alcoholLevel: string;
  alcoholTypes: string[];
  additionalRequest?: string;
  includeSecondRound?: boolean;
};

export type PriceRange = {
  min: number;
  max: number;
};

export type RestaurantCandidate = {
  id: string;
  name: string;
  category: string;
  distanceMeters: number | null;
  atmospheres: string[];
  occasions: string[];
  foodPreferences: string[];
  menus: string[];
  alcoholTypes?: string[];
  estimatedFoodPerPerson?: PriceRange;
  source?: "kakao" | "public" | "fallback";
  region?: "Seoul" | "Gyeonggi";
  isEligible?: boolean;
  address?: string;
  roadAddress?: string;
  phone?: string;
  placeUrl?: string;
  latitude?: number;
  longitude?: number;
  searchOrigin?: "firstRecommendation" | "input";
};

export type RecommendationLabel = "1순위" | "안전한 선택" | "색다른 선택";

export type RecommendationEstimate = {
  food: PriceRange;
  alcohol: PriceRange;
  perPerson: PriceRange;
  total: PriceRange;
  disclaimer: string;
};

export type RecommendationResultItem = {
  label: RecommendationLabel;
  restaurant: RestaurantCandidate;
  score: number;
  reasons: string[];
  estimate: RecommendationEstimate;
  explanation: string;
};

export type RecommendationResponseSource = "public" | "mixed" | "fallback";

export type RecommendationSuccessResponse = {
  ok: true;
  recommendations: RecommendationResultItem[];
  source: RecommendationResponseSource;
  warnings: string[];
  secondRoundRecommendations?: RestaurantCandidate[];
};

export type RecommendationRelaxationCode =
  | "ZERO_RESULTS"
  | "INSUFFICIENT_ELIGIBLE_CANDIDATES"
  | "INSUFFICIENT_ADVENTUROUS_DIVERSITY"
  | "DISTANCE_VERIFICATION_REQUIRED";

export type RecommendationRelaxationResponse = {
  ok: false;
  code: RecommendationRelaxationCode;
  eligibleCount: number;
  message: string;
  suggestions: string[];
  source?: RecommendationResponseSource;
  warnings?: string[];
};

export type RecommendationApiResponse =
  | RecommendationSuccessResponse
  | RecommendationRelaxationResponse;

export type ValidationErrors = Partial<Record<keyof RecommendationInput, string>>;

export type ValidationResult =
  | { ok: true; value: RecommendationInput }
  | { ok: false; errors: ValidationErrors };

export function isRecommendationInput(value: unknown): value is RecommendationInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<RecommendationInput>;
  if (!input.location || typeof input.location !== "object") return false;
  if (input.location.mode === "search") {
    if (typeof input.location.query !== "string") return false;
  } else if (input.location.mode === "current") {
    if (
      typeof input.location.latitude !== "number"
      || typeof input.location.longitude !== "number"
      || !Number.isFinite(input.location.latitude)
      || !Number.isFinite(input.location.longitude)
    ) return false;
  } else {
    return false;
  }
  return typeof input.headcount === "number"
    && typeof input.radiusMeters === "number"
    && typeof input.occasion === "string"
    && Array.isArray(input.atmospheres) && input.atmospheres.every((item) => typeof item === "string")
    && Array.isArray(input.foodPreferences) && input.foodPreferences.every((item) => typeof item === "string")
    && Array.isArray(input.menus) && input.menus.every((item) => typeof item === "string")
    && (input.budgetMode === "perPerson" || input.budgetMode === "total")
    && typeof input.budgetAmount === "number"
    && typeof input.alcoholLevel === "string"
    && Array.isArray(input.alcoholTypes) && input.alcoholTypes.every((item) => typeof item === "string")
    && (input.additionalRequest === undefined || typeof input.additionalRequest === "string")
    && (input.includeSecondRound === undefined || typeof input.includeSecondRound === "boolean");
}

export function validateRecommendationInput(value: RecommendationInput): ValidationResult {
  const errors: ValidationErrors = {};

  if (value.location.mode === "search" && !value.location.query.trim()) {
    errors.location = "역 이름이나 주소를 입력해 주세요.";
  }
  if (value.location.mode === "current") {
    const { latitude, longitude } = value.location;
    const hasCoordinates = latitude !== undefined || longitude !== undefined;
    if (hasCoordinates && (
      typeof latitude !== "number"
      || typeof longitude !== "number"
      || !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90
      || latitude > 90
      || longitude < -180
      || longitude > 180
    )) {
      errors.location = "현재 위치 좌표를 확인해 주세요.";
    }
  }
  if (!Number.isInteger(value.headcount) || value.headcount < 1) {
    errors.headcount = "인원은 1명 이상이어야 해요.";
  }
  if (!Number.isFinite(value.radiusMeters) || value.radiusMeters <= 0 || value.radiusMeters > 20000) {
    errors.radiusMeters = "검색 반경은 1m에서 20km 사이여야 해요.";
  }
  if (!value.occasion) {
    errors.occasion = "모임 이유를 선택해 주세요.";
  }
  if (!Number.isFinite(value.budgetAmount) || value.budgetAmount <= 0) {
    errors.budgetAmount = "예산은 0원보다 커야 해요.";
  }
  if (value.alcoholLevel === "안 마심" && value.alcoholTypes.length > 0) {
    errors.alcoholTypes = "술을 안 마시면 주종을 선택할 수 없어요.";
  }
  if (value.additionalRequest !== undefined && value.additionalRequest.length > 200) {
    errors.additionalRequest = "추가 요청사항은 200자 이내로 입력해 주세요.";
  }

  return Object.keys(errors).length === 0
    ? { ok: true, value: { ...value, includeSecondRound: value.includeSecondRound ?? true } }
    : { ok: false, errors };
}
