import "./server-only";
import type { RecommendationInput, RestaurantCandidate } from "./domain";

const KAKAO_LOCAL_BASE_URL = "https://dapi.kakao.com/v2/local/search";
const REST_KEY_NAME = "KAKAO_REST_API_KEY";
const SEOUL_GYEONGGI_ADDRESS = /^(서울(?:특별시)?|경기(?:도)?)(?:\s|$)/;

type KakaoPlace = {
  id: string;
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  phone: string;
  place_url: string;
  distance: string;
  x: string;
  y: string;
};

type KakaoSearchResponse = { documents?: KakaoPlace[] };
type Fetcher = (url: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

export type KakaoSearchErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_LOCATION"
  | "ZERO_RESULTS"
  | "REQUEST_FAILED";

export class KakaoSearchError extends Error {
  constructor(public readonly code: KakaoSearchErrorCode, message: string) {
    super(message);
    this.name = "KakaoSearchError";
  }
}

function getRegion(address: string, roadAddress: string): RestaurantCandidate["region"] | undefined {
  const source = roadAddress || address;
  if (!SEOUL_GYEONGGI_ADDRESS.test(source)) return undefined;
  return /^(서울|서울특별시)(?:\s|$)/.test(source) ? "Seoul" : "Gyeonggi";
}

export function mapKakaoPlace(place: KakaoPlace): RestaurantCandidate | null {
  const longitude = Number(place.x);
  const latitude = Number(place.y);
  const address = place.address_name || "";
  const roadAddress = place.road_address_name || "";
  const region = getRegion(address, roadAddress);

  if (!place.id || !place.place_name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !region) {
    return null;
  }

  const parsedDistance = place.distance.trim() === "" ? null : Number(place.distance);
  return {
    id: place.id,
    name: place.place_name,
    category: place.category_name || "음식점",
    address,
    roadAddress,
    phone: place.phone || "",
    placeUrl: place.place_url || "",
    distanceMeters: parsedDistance !== null && Number.isFinite(parsedDistance) ? parsedDistance : null,
    latitude,
    longitude,
    atmospheres: [],
    occasions: [],
    foodPreferences: [],
    menus: [],
    source: "kakao",
    region,
    isEligible: true,
  };
}

function buildSearchUrl(input: RecommendationInput): string {
  if (!Number.isFinite(input.radiusMeters) || input.radiusMeters <= 0 || input.radiusMeters > 20000) {
    throw new KakaoSearchError("INVALID_LOCATION", "검색 반경은 1m에서 20km 사이여야 해요.");
  }
  const url = new URL(`${KAKAO_LOCAL_BASE_URL}/${input.location.mode === "current" ? "category" : "keyword"}.json`);
  url.searchParams.set("size", "15");

  if (input.location.mode === "current") {
    const { latitude, longitude } = input.location;
    if (
      typeof latitude !== "number"
      || typeof longitude !== "number"
      || !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90
      || latitude > 90
      || longitude < -180
      || longitude > 180
    ) {
      throw new KakaoSearchError("INVALID_LOCATION", "현재 위치 좌표를 확인한 뒤 다시 시도해 주세요.");
    }
    url.searchParams.set("category_group_code", "FD6");
    url.searchParams.set("x", String(longitude));
    url.searchParams.set("y", String(latitude));
    url.searchParams.set("radius", String(Math.round(input.radiusMeters)));
  } else {
    const query = input.location.query.trim();
    if (!query) {
      throw new KakaoSearchError("INVALID_LOCATION", "역 또는 주소를 입력해 주세요.");
    }
    url.searchParams.set("query", `${query} 음식점`);
  }

  return url.toString();
}

export async function searchRestaurants(
  input: RecommendationInput,
  fetcher: Fetcher = fetch,
): Promise<RestaurantCandidate[]> {
  const url = buildSearchUrl(input);
  const key = process.env[REST_KEY_NAME];
  if (!key) {
    throw new KakaoSearchError("MISSING_API_KEY", "카카오 REST API 키가 설정되지 않았어요.");
  }

  let response: Pick<Response, "ok" | "status" | "json">;
  try {
    response = await fetcher(url, {
      headers: { Authorization: `KakaoAK ${key}` },
    });
  } catch {
    throw new KakaoSearchError("REQUEST_FAILED", "카카오 장소 검색 요청에 실패했어요.");
  }

  if (!response.ok) {
    throw new KakaoSearchError("REQUEST_FAILED", `카카오 장소 검색 요청에 실패했어요. (${response.status})`);
  }

  let body: KakaoSearchResponse;
  try {
    body = await response.json() as KakaoSearchResponse;
  } catch {
    throw new KakaoSearchError("REQUEST_FAILED", "카카오 장소 검색 응답을 읽지 못했어요.");
  }

  const restaurants = (body.documents ?? [])
    .map(mapKakaoPlace)
    .filter((place): place is RestaurantCandidate => place !== null)
    .map((place) => input.location.mode === "search" ? { ...place, distanceMeters: null } : place)
    .filter((place, index, all) => all.findIndex(({ id }) => id === place.id) === index);

  if (!restaurants.length) {
    throw new KakaoSearchError("ZERO_RESULTS", "서울·경기 지역에서 조건에 맞는 식당을 찾지 못했어요.");
  }

  return restaurants;
}
