import "./server-only";
import type { RecommendationInput, RestaurantCandidate } from "./domain";

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_INTERPRETER_URL = "https://overpass-api.de/api/interpreter";
const REQUEST_TIMEOUT_MS = 8_000;
const USER_AGENT = "meokjido-public-restaurant-search/1.0 (+https://meokjido.vercel.app)";

type GeocodingResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
};

type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: unknown;
};

type Fetcher = typeof fetch;

export type PublicSearchPurpose = "restaurant" | "cafe" | "secondRoundBar";

type Coordinates = {
  latitude: number;
  longitude: number;
  address: string;
};

function isInSeoul(latitude: number, longitude: number): boolean {
  return latitude >= 37.413 && latitude <= 37.716 && longitude >= 126.734 && longitude <= 127.27;
}

function getRegion(latitude: number, longitude: number): RestaurantCandidate["region"] | undefined {
  if (isInSeoul(latitude, longitude)) return "Seoul";
  if (latitude >= 36.89 && latitude <= 38.33 && longitude >= 126.37 && longitude <= 127.94) return "Gyeonggi";
  return undefined;
}

function distanceMeters(from: Coordinates, latitude: number, longitude: number): number {
  const earthRadiusMeters = 6_371_000;
  const radians = Math.PI / 180;
  const deltaLatitude = (latitude - from.latitude) * radians;
  const deltaLongitude = (longitude - from.longitude) * radians;
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(from.latitude * radians) * Math.cos(latitude * radians) * Math.sin(deltaLongitude / 2) ** 2;
  return Math.round(2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function fetchJson(fetcher: Fetcher, url: string, init: RequestInit): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodeAddress(query: string, fetcher: Fetcher): Promise<Coordinates | null> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", query);
  const body = await fetchJson(fetcher, url.toString(), { headers: { "User-Agent": USER_AGENT } });
  if (!Array.isArray(body) || !body[0] || typeof body[0] !== "object") return null;

  const result = body[0] as GeocodingResult;
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !getRegion(latitude, longitude)) return null;
  return { latitude, longitude, address: typeof result.display_name === "string" ? result.display_name : "" };
}

function purposeSelectors(purpose: PublicSearchPurpose): string[] {
  if (purpose === "cafe") {
    return ['["amenity"="cafe"]', '["amenity"="ice_cream"]', '["shop"="bakery"]', '["shop"="pastry"]', '["shop"="confectionery"]'];
  }
  if (purpose === "secondRoundBar") {
    return ['["amenity"="pub"]', '["amenity"="bar"]', '["amenity"="restaurant"]["cuisine"="izakaya"]'];
  }
  return ['["amenity"="restaurant"]'];
}

function buildOverpassQuery(
  coordinates: Coordinates,
  radiusMeters: number,
  purpose: PublicSearchPurpose,
): string {
  const around = `(around:${Math.round(radiusMeters)},${coordinates.latitude},${coordinates.longitude})`;
  const searches = purposeSelectors(purpose)
    .flatMap((selector) => [`node${around}${selector};`, `way${around}${selector};`])
    .join("");
  return `[out:json][timeout:10];(${searches});out center tags;`;
}

function placeAddress(tags: Record<string, unknown> | undefined, fallback: string): string {
  if (typeof tags?.["addr:full"] === "string" && tags["addr:full"].trim()) {
    return tags["addr:full"].trim();
  }
  const parts = [tags?.["addr:city"], tags?.["addr:street"], tags?.["addr:housenumber"]]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());
  return parts.length > 0 ? parts.join(" ") : fallback;
}

function mapElement(element: unknown, origin: Coordinates): RestaurantCandidate | null {
  if (!element || typeof element !== "object" || Array.isArray(element)) return null;
  const place = element as OverpassElement;
  const tags = place.tags && typeof place.tags === "object" && !Array.isArray(place.tags)
    ? place.tags as Record<string, unknown>
    : undefined;
  const latitude = place.lat ?? place.center?.lat;
  const longitude = place.lon ?? place.center?.lon;
  const name = typeof tags?.name === "string" ? tags.name.trim() : "";
  const region = typeof latitude === "number" && typeof longitude === "number" ? getRegion(latitude, longitude) : undefined;
  if (
    !name
    || (place.type !== "node" && place.type !== "way")
    || typeof place.id !== "number"
    || !Number.isInteger(place.id)
    || typeof latitude !== "number"
    || typeof longitude !== "number"
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || !region
  ) {
    return null;
  }

  return {
    id: `osm-${place.type}-${place.id}`,
    name,
    category: [tags?.cuisine, tags?.amenity, tags?.shop]
      .find((value): value is string => typeof value === "string" && Boolean(value.trim()))
      ?.trim() ?? "restaurant",
    address: placeAddress(tags, origin.address),
    distanceMeters: distanceMeters(origin, latitude, longitude),
    latitude,
    longitude,
    atmospheres: [],
    occasions: [],
    foodPreferences: [],
    menus: [],
    source: "public",
    region,
    isEligible: true,
  };
}

function validRadius(radiusMeters: number): boolean {
  return Number.isFinite(radiusMeters) && radiusMeters > 0 && radiusMeters <= 20_000;
}

export async function searchPublicRestaurants(
  input: RecommendationInput,
  fetcher: Fetcher = fetch,
  purpose: PublicSearchPurpose = "restaurant",
): Promise<RestaurantCandidate[]> {
  if (!validRadius(input.radiusMeters)) return [];

  const origin = input.location.mode === "current"
    ? (() => {
      const { latitude, longitude } = input.location;
      if (
        typeof latitude !== "number"
        || typeof longitude !== "number"
        || !Number.isFinite(latitude)
        || !Number.isFinite(longitude)
        || !getRegion(latitude, longitude)
      ) return null;
      return { latitude, longitude, address: "" };
    })()
    : await geocodeAddress(input.location.query.trim(), fetcher);
  if (!origin) return [];

  const body = await fetchJson(fetcher, OVERPASS_INTERPRETER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({ data: buildOverpassQuery(origin, input.radiusMeters, purpose) }).toString(),
  });
  if (!body || typeof body !== "object" || !Array.isArray((body as { elements?: unknown }).elements)) return [];

  const seen = new Set<string>();
  return (body as { elements: unknown[] }).elements.flatMap((element) => {
    const candidate = mapElement(element, origin);
    if (!candidate || seen.has(candidate.id)) return [];
    seen.add(candidate.id);
    return [candidate];
  });
}
