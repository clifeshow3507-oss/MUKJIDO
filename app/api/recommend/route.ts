import { after, NextResponse } from "next/server";
import { createAnonymousRecommendationEvent, recordAnonymousEvent } from "../../../lib/analytics";
import {
  isRecommendationInput,
  validateRecommendationInput,
} from "../../../lib/domain";
import { buildRecommendationResponse } from "../../../lib/recommendation-service";

export async function POST(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_INPUT", message: "요청 내용을 확인해 주세요." }, { status: 400 });
  }
  if (!isRecommendationInput(value)) {
    return NextResponse.json({ ok: false, code: "INVALID_INPUT", message: "추천 조건 형식이 올바르지 않아요." }, { status: 400 });
  }
  const validation = validateRecommendationInput(value);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, code: "INVALID_INPUT", message: "추천 조건을 확인해 주세요.", errors: validation.errors }, { status: 400 });
  }
  const result = await buildRecommendationResponse(validation.value);
  const event = createAnonymousRecommendationEvent(validation.value, result.body);
  after(() => recordAnonymousEvent(event));
  return NextResponse.json(result.body, { status: result.status });
}
