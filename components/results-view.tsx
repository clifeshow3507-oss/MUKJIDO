"use client";

import { useState } from "react";
import type {
  PriceRange,
  RecommendationApiResponse,
  RecommendationInput,
} from "../lib/domain";
import { KakaoMap } from "./kakao-map";
import { createSharePayload } from "../lib/share";

type ResultsViewProps = {
  result?: RecommendationApiResponse;
  input: RecommendationInput;
  loading?: boolean;
  error?: string;
  onEdit: () => void;
  onRetry: () => void;
  onNewRecommendation: () => void;
};

function formatRange(range: PriceRange) {
  return `${range.min.toLocaleString("ko-KR")}~${range.max.toLocaleString("ko-KR")}원`;
}

function isBarSecondRound(occasion: string) {
  return /저녁|회식|술|dinner|drinking/i.test(occasion);
}

export function ResultsView({
  result,
  input,
  loading = false,
  error,
  onEdit,
  onRetry,
  onNewRecommendation,
}: ResultsViewProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const [shareMessage, setShareMessage] = useState("");

  if (loading) {
    return <section className="result-state" role="status" aria-live="polite">추천을 찾고 있어요. 잠시만 기다려 주세요.</section>;
  }

  if (error) {
    return (
      <section className="result-state result-error" role="alert">
        <strong>추천을 불러오지 못했어요.</strong>
        <p>{error}</p>
        <button type="button" onClick={onRetry}>다시 추천</button>
      </section>
    );
  }

  if (!result) return null;

  if (!result.ok) {
    const needsDistanceVerification = result.code === "DISTANCE_VERIFICATION_REQUIRED";
    return (
      <section className="relaxation-panel" aria-labelledby="relaxation-title">
        {result.warnings?.map((warning) => <p className="result-warning" role="status" key={warning}>{warning}</p>)}
        <h2 id="relaxation-title">{needsDistanceVerification ? "거리 확인이 필요해요" : "조건을 조금 바꿔볼까요?"}</h2>
        <p>{result.message}</p>
        <ul>{result.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
        <div className="result-actions">
          <button type="button" onClick={onEdit}>조건 수정</button>
          <button type="button" onClick={onRetry}>다시 추천</button>
          <button type="button" onClick={onNewRecommendation}>새 추천</button>
        </div>
      </section>
    );
  }

  const activeId = selectedId ?? result.recommendations[0]?.restaurant.id;
  const share = async () => {
    setShareMessage("");
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createSharePayload(
          input,
          result.recommendations.map(({ restaurant }) => restaurant.id),
        )),
      });
      if (!response.ok) throw new Error("share failed");
      const body = await response.json() as { shareUrl?: string };
      if (!body.shareUrl) throw new Error("share URL missing");
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(body.shareUrl);
      setShareMessage("공유 링크를 복사했어요.");
    } catch {
      setShareMessage("공유 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <section className="results" aria-labelledby="results-title">
      <div className="results-heading">
        <p className="eyebrow">조건을 바꾸지 않고 찾은 세 곳</p>
        <h2 id="results-title">오늘의 추천 결과</h2>
        <p>카드와 지도에서 같은 식당을 선택해 비교할 수 있어요.</p>
      </div>

      {result.warnings.map((warning) => (
        <p className="result-warning" role="status" key={warning}>{warning}</p>
      ))}

      <div className="result-grid">
        {result.recommendations.map((recommendation) => {
          const { restaurant, estimate } = recommendation;
          const encodedRestaurantName = encodeURIComponent(restaurant.name);
          const naverMapUrl = `https://map.naver.com/p/search/${encodedRestaurantName}`;
          const kakaoMapUrl = `https://map.kakao.com/?q=${encodedRestaurantName}`;
          return (
            <article className="result-card" key={restaurant.id} data-selected={restaurant.id === activeId}>
              <div className="result-card-heading">
                <h3>{recommendation.label}</h3>
                <strong aria-label={`${recommendation.score}점`}>{recommendation.score}점</strong>
              </div>
              <h4>{restaurant.name}</h4>
              <p className="restaurant-meta">{restaurant.category} · {restaurant.address || restaurant.roadAddress || "상세 주소는 지도에서 확인"} · {restaurant.distanceMeters === null ? "주소 기준 추천" : `${restaurant.distanceMeters}m`}</p>
              <p className="result-explanation">{recommendation.explanation}</p>
              <ul className="fact-list" aria-label={`${restaurant.name} 추천 근거`}>
                {recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <dl className="estimate-list">
                <div><dt>음식비 (전체)</dt><dd>{formatRange(estimate.food)}</dd></div>
                <div><dt>주류비 (전체)</dt><dd>{formatRange(estimate.alcohol)}</dd></div>
                <div><dt>총 예상</dt><dd>{formatRange(estimate.total)}</dd></div>
              </dl>
              <p className="estimate-disclaimer">{estimate.disclaimer}</p>
              <div className="card-actions">
                <button
                  type="button"
                  aria-pressed={restaurant.id === activeId}
                  onClick={() => setSelectedId(restaurant.id)}
                >
                  {restaurant.name} 선택
                </button>
                <a href={naverMapUrl} target="_blank" rel="noreferrer" aria-label={`${restaurant.name} 네이버지도에서 보기`}>네이버지도에서 보기</a>
                <a href={kakaoMapUrl} target="_blank" rel="noreferrer" aria-label={`${restaurant.name} 카카오맵에서 보기`}>카카오맵에서 보기</a>
              </div>
            </article>
          );
        })}
      </div>

      <KakaoMap
        restaurants={result.recommendations.map(({ restaurant }) => restaurant)}
        selectedId={activeId}
        onSelect={setSelectedId}
      />

      {input.includeSecondRound !== false
        && result.secondRoundRecommendations
        && result.secondRoundRecommendations.length > 0 && (
        <section className="second-round" aria-labelledby="second-round-title">
          <div className="results-heading">
            <p className="eyebrow">식사 뒤 동선을 이어가 보세요</p>
            <h2 id="second-round-title">이어서 갈 2차 장소</h2>
          </div>
          <div className="second-round-grid">
            {result.secondRoundRecommendations.map((place) => {
              const barPurpose = isBarSecondRound(input.occasion);
              const purposeLabel = barPurpose ? "호프·이자카야 추천" : "카페·디저트 추천";
              const reason = barPurpose
                ? "저녁 모임 뒤 가볍게 한잔하기 좋은 호프·이자카야예요."
                : "식사 후 대화를 이어가기 좋은 카페·디저트 장소예요.";
              const originLabel = place.searchOrigin === "firstRecommendation"
                ? "1차 장소 주변 검색 기준"
                : "입력 장소 검색 기준";
              const encodedName = encodeURIComponent(place.name);
              return (
                <article className="second-round-card" key={place.id}>
                  <p className="eyebrow">{purposeLabel}</p>
                  <h3>{place.name}</h3>
                  <p className="restaurant-meta">
                    {place.address || place.roadAddress || "상세 주소는 지도에서 확인"} · {place.distanceMeters === null ? originLabel : `${place.distanceMeters}m`}
                  </p>
                  <p className="result-explanation">{reason}</p>
                  <div className="card-actions">
                    <a href={`https://map.naver.com/p/search/${encodedName}`} target="_blank" rel="noreferrer" aria-label={`${place.name} 네이버지도에서 보기`}>네이버지도에서 보기</a>
                    <a href={`https://map.kakao.com/?q=${encodedName}`} target="_blank" rel="noreferrer" aria-label={`${place.name} 카카오맵에서 보기`}>카카오맵에서 보기</a>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="result-actions" aria-label="추천 결과 작업">
        <button type="button" onClick={onEdit}>조건 수정</button>
        <button type="button" onClick={onRetry}>다시 추천</button>
        <button type="button" onClick={onNewRecommendation}>새 추천</button>
        <button type="button" onClick={share}>결과 링크 공유</button>
      </div>
      {shareMessage && <p className="share-message" role="status" aria-live="polite">{shareMessage}</p>}
    </section>
  );
}
