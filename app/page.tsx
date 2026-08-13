"use client";

import { useState } from "react";
import { RecommendationWizard } from "../components/recommendation-wizard";
import { ResultsView } from "../components/results-view";
import type { RecommendationApiResponse, RecommendationInput } from "../lib/domain";

function currentPosition(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("현재 위치를 사용할 수 없어요. 역·주소 검색을 선택해 주세요."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => reject(new Error("위치 권한을 허용하거나 역·주소 검색을 선택해 주세요.")),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
    );
  });
}

export default function HomePage() {
  const [showWizard, setShowWizard] = useState(false);
  const [wizardKey, setWizardKey] = useState(0);
  const [submittedInput, setSubmittedInput] = useState<RecommendationInput | null>(null);
  const [result, setResult] = useState<RecommendationApiResponse>();
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const requestRecommendation = async (rawInput: RecommendationInput) => {
    setLoading(true);
    setError("");
    setResult(undefined);
    try {
      let input = rawInput;
      if (rawInput.location.mode === "current") {
        setLocating(true);
        input = { ...rawInput, location: { mode: "current" as const, ...await currentPosition() } };
        setLocating(false);
      }
      setSubmittedInput(input);
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json() as RecommendationApiResponse & { message?: string };
      if (!response.ok && !(body.ok === false && Array.isArray(body.suggestions))) {
        throw new Error(body.message || "추천 요청에 실패했어요.");
      }
      setResult(body);
      setShowWizard(false);
    } catch (requestError) {
      setLocating(false);
      setError(requestError instanceof Error ? requestError.message : "추천 요청에 실패했어요.");
    } finally {
      setLoading(false);
    }
  };

  const newRecommendation = () => {
    setWizardKey((current) => current + 1);
    setSubmittedInput(null);
    setResult(undefined);
    setError("");
    setShowWizard(true);
  };

  return (
    <main className="brand-shell">
      <section className="hero" aria-labelledby="service-name">
        <p className="eyebrow">서울·경기 직장인을 위한 점심 안내</p>
        <h1 id="service-name">직장인 필수 먹지도</h1>
        <p className="subtitle">먹을 곳을 알고, 그려주는 지도</p>
        <div className="recommendation-surface">
          <span aria-hidden="true" className="surface-icon">🍽</span>
          <div>
            <p className="surface-label">오늘의 점심, 어디서 시작할까요?</p>
            <p className="surface-detail">내 주변 맛집을 가볍게 추천받아 보세요.</p>
          </div>
          <button
            type="button"
            aria-expanded={showWizard}
            aria-controls="recommendation-wizard"
            onClick={() => setShowWizard(true)}
          >
            추천 시작하기
          </button>
        </div>
        {showWizard && (
          <RecommendationWizard key={wizardKey} onSubmit={requestRecommendation} />
        )}
        {locating && <section className="result-state" role="status">현재 위치를 확인하고 있어요.</section>}
        {error && !submittedInput && (
          <section className="result-state result-error" role="alert">
            <strong>추천을 시작하지 못했어요.</strong>
            <p>{error}</p>
          </section>
        )}
        {(loading || error || result) && submittedInput && (
          <ResultsView
            input={submittedInput}
            result={result}
            loading={loading}
            error={error}
            onEdit={() => setShowWizard(true)}
            onRetry={() => requestRecommendation(submittedInput)}
            onNewRecommendation={newRecommendation}
          />
        )}
      </section>
    </main>
  );
}
