"use client";

import { useState } from "react";
import {
  type RecommendationInput,
  type ValidationErrors,
  validateRecommendationInput,
} from "../lib/domain";

type RecommendationWizardProps = {
  onSubmit: (input: RecommendationInput) => void;
};

const radiusOptions = [500, 1000, 2000];
const occasions = ["점심", "저녁", "회식", "거래처", "가족 모임"];
const atmospheres = ["조용한 대화", "활기찬 회식", "격식 있는 식사", "편안한 모임", "프라이빗"];
const foodPreferences = ["매운맛", "가벼운 식사", "고기", "해산물", "채식 배려", "새로운 음식"];
const menus = ["한식", "고기", "일식", "중식", "양식", "해산물", "분식", "상관없음"];
const alcoholLevels = ["안 마심", "가볍게", "보통", "많이"];
const alcoholTypes = ["소주", "맥주", "와인", "전통주", "위스키·하이볼"];

const initialInput: RecommendationInput = {
  location: { mode: "current" },
  headcount: 2,
  radiusMeters: 1000,
  occasion: "",
  atmospheres: [],
  foodPreferences: [],
  menus: [],
  budgetMode: "perPerson",
  budgetAmount: 0,
  alcoholLevel: "안 마심",
  alcoholTypes: [],
  includeSecondRound: true,
};

function toggleItem(items: string[], item: string) {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

function ChoiceButton({
  selected,
  children,
  onClick,
}: {
  selected: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="choice-button"
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function RecommendationWizard({ onSubmit }: RecommendationWizardProps) {
  const [stage, setStage] = useState(1);
  const [input, setInput] = useState<RecommendationInput>(initialInput);
  const [errors, setErrors] = useState<ValidationErrors>({});

  const setField = <K extends keyof RecommendationInput>(key: K, value: RecommendationInput[K]) => {
    setInput((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const goNext = () => {
    if (stage === 1 && input.headcount < 1) {
      setErrors({ headcount: "인원은 1명 이상이어야 해요." });
      return;
    }
    setStage((current) => Math.min(3, current + 1));
  };

  const submit = () => {
    const { additionalRequest: rawAdditionalRequest, ...baseInput } = input;
    const additionalRequest = rawAdditionalRequest?.trim();
    const submissionInput: RecommendationInput = {
      ...baseInput,
      ...(additionalRequest ? { additionalRequest } : {}),
    };
    const validation = validateRecommendationInput(submissionInput);
    if (!validation.ok) {
      setErrors(validation.errors);
      if (validation.errors.location || validation.errors.headcount || validation.errors.radiusMeters) {
        setStage(1);
      } else if (validation.errors.occasion) {
        setStage(2);
      } else {
        setStage(3);
      }
      return;
    }
    onSubmit(validation.value);
  };

  const changeBudgetMode = (budgetMode: RecommendationInput["budgetMode"]) => {
    setInput((current) => {
      if (current.budgetMode === budgetMode) return current;
      const budgetAmount = current.budgetMode === "perPerson"
        ? current.budgetAmount * current.headcount
        : Math.round(current.budgetAmount / current.headcount);
      return { ...current, budgetMode, budgetAmount };
    });
  };

  const counterpart = input.budgetMode === "perPerson"
    ? input.budgetAmount * input.headcount
    : input.headcount > 0 ? Math.round(input.budgetAmount / input.headcount) : 0;

  return (
    <section className="wizard" id="recommendation-wizard" aria-labelledby="wizard-title">
      <div className="wizard-heading">
        <p className="wizard-progress" aria-live="polite">{stage} / 3 단계</p>
        <h2 id="wizard-title">조건을 알려주세요</h2>
        <p>버튼으로 간단히 골라 더 잘 맞는 식당을 찾아드릴게요.</p>
      </div>

      {stage === 1 && (
        <div className="wizard-stage">
          <fieldset>
            <legend>어디에서 찾을까요?</legend>
            <div className="choice-list">
              <ChoiceButton
                selected={input.location.mode === "current"}
                onClick={() => setField("location", { mode: "current" })}
              >
                현재 위치 사용
              </ChoiceButton>
              <ChoiceButton
                selected={input.location.mode === "search"}
                onClick={() => setField("location", { mode: "search", query: "" })}
              >
                역·주소 검색
              </ChoiceButton>
            </div>
            {input.location.mode === "search" && (
              <label className="input-label">
                역 또는 주소
                <input
                  value={input.location.query}
                  onChange={(event) => setField("location", { mode: "search", query: event.target.value })}
                  placeholder="예: 강남역"
                />
              </label>
            )}
            {errors.location && <p className="field-error" role="alert">{errors.location}</p>}
          </fieldset>

          <fieldset>
            <legend>몇 명이 함께하나요?</legend>
            <div className="choice-list">
              {[2, 4, 6, 8].map((headcount) => (
                <ChoiceButton
                  key={headcount}
                  selected={input.headcount === headcount}
                  onClick={() => setField("headcount", headcount)}
                >
                  {headcount}명
                </ChoiceButton>
              ))}
              <button
                type="button"
                className="stepper-button"
                aria-label="인원 줄이기"
                onClick={() => setField("headcount", Math.max(1, input.headcount - 1))}
              >
                −
              </button>
              <output aria-label="현재 인원">{input.headcount}명</output>
              <button
                type="button"
                className="stepper-button"
                aria-label="인원 늘리기"
                onClick={() => setField("headcount", input.headcount + 1)}
              >
                +
              </button>
            </div>
            {errors.headcount && <p className="field-error" role="alert">{errors.headcount}</p>}
          </fieldset>

          <fieldset>
            <legend>검색 반경</legend>
            <div className="choice-list">
              {radiusOptions.map((radius) => (
                <ChoiceButton
                  key={radius}
                  selected={input.radiusMeters === radius}
                  onClick={() => setField("radiusMeters", radius)}
                >
                  {radius >= 1000 ? `${radius / 1000}km` : `${radius}m`}
                </ChoiceButton>
              ))}
            </div>
            {errors.radiusMeters && <p className="field-error" role="alert">{errors.radiusMeters}</p>}
          </fieldset>
        </div>
      )}

      {stage === 2 && (
        <div className="wizard-stage">
          <fieldset>
            <legend><span role="heading" aria-level={3}>모임 이유</span></legend>
            <div className="choice-list">
              {occasions.map((occasion) => (
                <ChoiceButton key={occasion} selected={input.occasion === occasion} onClick={() => setField("occasion", occasion)}>
                  {occasion}
                </ChoiceButton>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>자리 분위기</legend>
            <div className="choice-list">
              {atmospheres.map((atmosphere) => (
                <ChoiceButton
                  key={atmosphere}
                  selected={input.atmospheres.includes(atmosphere)}
                  onClick={() => setField("atmospheres", toggleItem(input.atmospheres, atmosphere))}
                >
                  {atmosphere}
                </ChoiceButton>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>음식 취향</legend>
            <div className="choice-list">
              {foodPreferences.map((preference) => (
                <ChoiceButton
                  key={preference}
                  selected={input.foodPreferences.includes(preference)}
                  onClick={() => setField("foodPreferences", toggleItem(input.foodPreferences, preference))}
                >
                  {preference}
                </ChoiceButton>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>메뉴</legend>
            <div className="choice-list">
              {menus.map((menu) => (
                <ChoiceButton
                  key={menu}
                  selected={input.menus.includes(menu)}
                  onClick={() => setField("menus", menu === "상관없음" ? [menu] : toggleItem(input.menus.filter((item) => item !== "상관없음"), menu))}
                >
                  {menu}
                </ChoiceButton>
              ))}
            </div>
          </fieldset>
          {errors.occasion && <p className="field-error" role="alert">{errors.occasion}</p>}
        </div>
      )}

      {stage === 3 && (
        <div className="wizard-stage">
          <fieldset>
            <legend>예산</legend>
            <div className="choice-list">
              <ChoiceButton selected={input.budgetMode === "perPerson"} onClick={() => changeBudgetMode("perPerson")}>1인당</ChoiceButton>
              <ChoiceButton selected={input.budgetMode === "total"} onClick={() => changeBudgetMode("total")}>전체</ChoiceButton>
            </div>
            <label className="input-label">
              {input.budgetMode === "perPerson" ? "1인당 예산" : "전체 예산"}
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={input.budgetAmount || ""}
                onChange={(event) => setField("budgetAmount", Number(event.target.value))}
                placeholder="예: 30000"
              />
            </label>
            <p className="budget-counterpart">
              {input.budgetMode === "perPerson" ? "전체 예상" : "1인당 예상"} {counterpart.toLocaleString("ko-KR")}원
            </p>
            {errors.budgetAmount && <p className="field-error" role="alert">{errors.budgetAmount}</p>}
          </fieldset>
          <fieldset>
            <legend>술은 어느 정도 드시나요?</legend>
            <div className="choice-list">
              {alcoholLevels.map((level) => (
                <ChoiceButton
                  key={level}
                  selected={input.alcoholLevel === level}
                  onClick={() => setInput((current) => ({
                    ...current,
                    alcoholLevel: level,
                    alcoholTypes: level === "안 마심" ? [] : current.alcoholTypes,
                  }))}
                >
                  {level}
                </ChoiceButton>
              ))}
            </div>
          </fieldset>
          {input.alcoholLevel !== "안 마심" && (
            <fieldset>
              <legend>주요 주종</legend>
              <div className="choice-list">
                {alcoholTypes.map((type) => (
                  <ChoiceButton
                    key={type}
                    selected={input.alcoholTypes.includes(type)}
                    onClick={() => setField("alcoholTypes", toggleItem(input.alcoholTypes, type))}
                  >
                    {type}
                  </ChoiceButton>
                ))}
              </div>
            </fieldset>
          )}
          <label className="input-label">
            추가 요청사항
            <textarea
              value={input.additionalRequest ?? ""}
              onChange={(event) => setField("additionalRequest", event.target.value)}
              maxLength={200}
              placeholder="예: 조용한 룸, 주차 가능, 매운 음식 제외"
              rows={3}
            />
          </label>
          <ChoiceButton
            selected={input.includeSecondRound !== false}
            onClick={() => setField("includeSecondRound", input.includeSecondRound === false)}
          >
            2차도 추천받기
          </ChoiceButton>
        </div>
      )}

      <div className="wizard-actions">
        {stage > 1 && <button type="button" className="secondary-action" onClick={() => setStage((current) => current - 1)}>이전</button>}
        {stage < 3 ? (
          <button type="button" className="primary-action" onClick={goNext}>다음</button>
        ) : (
          <button type="button" className="primary-action" onClick={submit}>추천받기</button>
        )}
      </div>
    </section>
  );
}
