import { NextResponse } from "next/server";
import { canonicalizeSharePayload, createShareUrl } from "../../../lib/share";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "공유할 결과를 확인해 주세요." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "공유할 결과를 확인해 주세요." }, { status: 400 });
  }
  const payload = canonicalizeSharePayload(body);
  if (!payload) {
    return NextResponse.json({ message: "공유할 결과 형식이 올바르지 않아요." }, { status: 400 });
  }
  if (!payload.restaurantIds.length) {
    return NextResponse.json({ message: "공유할 식당을 확인해 주세요." }, { status: 400 });
  }
  return NextResponse.json({ shareUrl: createShareUrl(new URL(request.url).origin, payload) });
}
