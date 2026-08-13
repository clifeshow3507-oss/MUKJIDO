# 먹지도

서울·경기 직장인을 위한 점심·모임 식당 추천 MVP입니다. 위치, 인원, 반경, 모임 성격, 메뉴, 예산, 주류 조건을 입력하면 서로 성격이 다른 식당 세 곳과 예상 비용을 보여 줍니다.

## 로컬 실행

요구 사항은 Node.js 20 이상과 pnpm 10입니다.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

`http://localhost:3000`에서 앱을 엽니다. 비밀값을 저장한 `.env.local`은 Git에 포함하지 마세요.

## 환경 변수

`.env.example`을 복사한 뒤 필요한 값만 설정합니다.

| 변수 | 노출 범위 | 필수 여부 | 없을 때 동작 |
| --- | --- | --- | --- |
| `KAKAO_REST_API_KEY` | 서버 전용 | 실시간 검색에 필요 | 서울·경기 데모 데이터로 전환하고 실시간 결과가 아니라는 경고를 표시합니다. 검색 기준점과 거리를 검증할 수 없으면 조건 완화 화면을 표시합니다. |
| `NEXT_PUBLIC_KAKAO_MAP_APP_KEY` | 브라우저 공개 | 지도 렌더링에 필요 | 결과 카드와 식당 목록은 유지되고, 지도 영역에 설정 안내를 표시합니다. 배포 도메인을 Kakao Developers에 등록해야 합니다. |
| `OPENROUTER_API_KEY` | 서버 전용 | 선택 | 점수, 근거, 예상 비용으로 만든 결정론적 한국어 설명을 사용합니다. 호출 실패나 시간 초과도 같은 설명으로 대체됩니다. |
| `OPENROUTER_MODEL` | 서버 전용 | 선택 | 값이 없으면 `openai/gpt-latest`를 사용합니다. API 키가 없으면 사용되지 않습니다. |
| `SUPABASE_URL` | 서버 전용 | 익명 분석에 필요 | 추천은 정상 동작하고 익명 분석 이벤트만 저장하지 않습니다. |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 | 익명 분석에 필요 | 추천은 정상 동작하고 익명 분석 이벤트만 저장하지 않습니다. 클라이언트에 노출하지 마세요. |

Kakao REST 키, OpenRouter 키, Supabase 서비스 역할 키에는 절대 `NEXT_PUBLIC_` 접두사를 붙이지 마세요. 저장소와 문서에는 실제 키를 넣지 않습니다.

Supabase 분석을 켤 때는 `supabase/migrations/20260813000000_create_anonymous_recommendation_events.sql`을 대상 프로젝트에 먼저 적용합니다. 저장은 추천 응답 이후에 짧은 제한 시간으로 수행되며, 분석 실패가 추천 응답을 막지는 않습니다.

## 검증

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
```

Playwright는 빌드와 서버를 모두 빈 외부 API 설정으로 실행하고 `/api/recommend` 및 `/api/share`를 브라우저 네트워크 계층에서 모킹합니다. `scripts/run-node-with-empty-external-env.mjs`가 빌드 전에 외부 서비스 환경 변수 여섯 개를 빈 값으로 덮어쓰며 값을 출력하지 않습니다. 따라서 성공, 조건 완화, 오류, 공유 시나리오는 로컬 셸의 키나 외부 서비스와 무관하게 결정론적으로 실행됩니다. 테스트 프로젝트는 모바일 `390x844`와 데스크톱 `1440x900`입니다.

`pnpm test:e2e`는 프로덕션 빌드를 먼저 만든 뒤 해당 서버에서 브라우저 테스트를 수행합니다.

Playwright가 관리하는 Chromium이 설치되지 않은 로컬 Windows 환경에서는 설치된 Chrome을 명시할 수 있습니다.

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm test:e2e
```

Windows 프로세스 환경에 따라 Playwright가 시작한 Next 서버의 종료가 지연되면, 먼저 빌드한 앱을 별도 터미널에서 실행하고 기존 서버 재사용 모드로 브라우저 테스트만 실행합니다.

```powershell
# 터미널 1
pnpm build:e2e
node scripts/run-node-with-empty-external-env.mjs node_modules/next/dist/bin/next start --hostname 127.0.0.1

# 터미널 2
$env:PLAYWRIGHT_REUSE_EXISTING_SERVER = '1'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm test:e2e:run
```

CI에서는 일반적으로 `pnpm exec playwright install --with-deps chromium`으로 Chromium을 준비하고 경로 재정의 없이 `pnpm test:e2e`를 실행합니다.

## 배포 준비

Vercel 프로젝트의 루트 디렉터리를 이 저장소로 지정하고 프레임워크를 Next.js로 선택합니다. 설치, 빌드, 출력 설정은 각각 기본값(`pnpm install`, `pnpm build`, Next.js 출력)을 사용합니다.

배포 전에는 다음을 확인합니다.

1. 필요한 환경 변수를 Preview와 Production에 각각 등록합니다.
2. Kakao Maps JavaScript 앱 설정에 Preview/Production 도메인을 등록합니다.
3. `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`를 실행합니다.
4. 추적되지 않은 `.env*`, 인증서, 키 파일이 없는지 확인합니다.
5. 키가 없는 배포라면 데모 데이터·지도 비활성·분석 비활성 상태를 제품 의도와 맞춰 확인합니다.

이 저장소에는 ESLint 의존성이 없으므로 별도 lint 스크립트를 추가하지 않았습니다. 현재 정적 검증은 TypeScript와 Next.js 빌드가 담당합니다.
배포 업데이트 
