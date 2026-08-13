"use client";

import { useEffect, useRef, useState } from "react";
import type { RestaurantCandidate } from "../lib/domain";

type KakaoMaps = {
  load: (callback: () => void) => void;
  LatLng: new (latitude: number, longitude: number) => unknown;
  Map: new (container: HTMLElement, options: { center: unknown; level: number }) => { setCenter?: (position: unknown) => void };
  Marker: new (options: { map: unknown; position: unknown; title: string }) => {
    setMap?: (map: unknown) => void;
    setZIndex?: (zIndex: number) => void;
  };
  event: { addListener: (target: unknown, event: string, callback: () => void) => void };
};

declare global {
  interface Window {
    kakao?: { maps?: KakaoMaps };
  }
}

type KakaoMapProps = {
  restaurants: RestaurantCandidate[];
  selectedId?: string;
  onSelect: (id: string) => void;
};

type MarkerRecord = { id: string; marker: { setMap?: (map: unknown) => void; setZIndex?: (zIndex: number) => void } };
export const KAKAO_SDK_LOAD_TIMEOUT_MS = 8000;

function loadKakaoSdk(appKey: string): Promise<KakaoMaps> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      callback();
    };
    const fail = (message: string) => settle(() => reject(new Error(message)));
    const succeed = (maps: KakaoMaps) => settle(() => resolve(maps));
    const timeoutId = window.setTimeout(
      () => fail("Kakao Maps SDK loading timed out."),
      KAKAO_SDK_LOAD_TIMEOUT_MS,
    );
    const initializeMaps = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        fail("Kakao Maps SDK was not available after loading.");
        return;
      }
      try {
        maps.load(() => succeed(maps));
      } catch {
        fail("Kakao Maps SDK failed to initialize.");
      }
    };

    if (window.kakao?.maps) {
      initializeMaps();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-kakao-map-sdk="true"]');
    const script = existing ?? document.createElement("script");

    script.addEventListener("load", initializeMaps, { once: true });
    script.addEventListener("error", () => fail("Kakao Maps SDK failed to load."), { once: true });
    if (!existing) {
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=${encodeURIComponent(appKey)}`;
      script.async = true;
      script.dataset.kakaoMapSdk = "true";
      document.head.appendChild(script);
    }
  });
}

export function KakaoMap({ restaurants, selectedId, onSelect }: KakaoMapProps) {
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_APP_KEY;
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<{ setCenter?: (position: unknown) => void } | null>(null);
  const markers = useRef<MarkerRecord[]>([]);
  const [unavailable, setUnavailable] = useState(!appKey);

  useEffect(() => {
    if (!appKey || !mapElement.current) return;
    let active = true;

    loadKakaoSdk(appKey)
      .then((maps) => {
        if (!active || !mapElement.current) return;
        const first = restaurants.find((restaurant) => Number.isFinite(restaurant.latitude) && Number.isFinite(restaurant.longitude));
        if (!first || first.latitude === undefined || first.longitude === undefined) {
          setUnavailable(true);
          return;
        }
        const kakaoMap = new maps.Map(mapElement.current, {
          center: new maps.LatLng(first.latitude, first.longitude),
          level: 4,
        });
        map.current = kakaoMap;
        markers.current = restaurants.flatMap((restaurant) => {
          if (restaurant.latitude === undefined || restaurant.longitude === undefined) return [];
          const marker = new maps.Marker({
            map: kakaoMap,
            position: new maps.LatLng(restaurant.latitude, restaurant.longitude),
            title: restaurant.name,
          });
          maps.event.addListener(marker, "click", () => onSelect(restaurant.id));
          return [{ id: restaurant.id, marker }];
        });
        markers.current.forEach(({ id, marker }) => marker.setZIndex?.(id === selectedId ? 2 : 1));
        const selected = restaurants.find(({ id }) => id === selectedId) ?? first;
        if (selected.latitude !== undefined && selected.longitude !== undefined) {
          kakaoMap.setCenter?.(new maps.LatLng(selected.latitude, selected.longitude));
        }
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });

    return () => {
      active = false;
      markers.current.forEach(({ marker }) => marker.setMap?.(null));
      markers.current = [];
      map.current = null;
    };
  }, [appKey, onSelect, restaurants]);

  useEffect(() => {
    markers.current.forEach(({ id, marker }) => marker.setZIndex?.(id === selectedId ? 2 : 1));
    const selected = restaurants.find(({ id }) => id === selectedId);
    if (selected?.latitude !== undefined && selected.longitude !== undefined) {
      map.current?.setCenter?.(new (window.kakao?.maps?.LatLng ?? class {})(selected.latitude, selected.longitude));
    }
  }, [restaurants, selectedId]);

  return (
    <section aria-label="식당 지도" className="kakao-map">
      {unavailable ? (
        <div role="status" className="map-unavailable">
          <strong>지도를 불러올 수 없어요.</strong>
          <p>{appKey ? "잠시 후 다시 시도해 주세요." : "위 버튼으로 지도 서비스에서 식당 위치를 확인해 주세요."}</p>
        </div>
      ) : (
        <div ref={mapElement} className="map-canvas" aria-label="카카오 지도" />
      )}
      <ul aria-label="식당 목록" className="map-restaurant-list">
        {restaurants.map((restaurant) => (
          <li key={restaurant.id}>
            <button
              type="button"
              aria-pressed={restaurant.id === selectedId}
              onClick={() => onSelect(restaurant.id)}
            >
              {restaurant.name} · {restaurant.distanceMeters === null ? "주소 기준 추천" : `${restaurant.distanceMeters}m`}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
