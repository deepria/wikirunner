# WikiRunner

나무위키 문서 내부 링크만 이용해 시작 문서에서 목표 문서까지 도달하는 스피드런 게임입니다. 웹에서 방과 경기를 관리하고, Chrome 확장 프로그램이 실제 이동을 기록·검증합니다.

## 구성

| 경로 | 역할 |
| --- | --- |
| `apps/web` | 방 생성, 설정, 준비, 순위 확인을 위한 Next.js 웹 앱 |
| `apps/extension` | 나무위키 이동을 감지하는 Chrome 확장 프로그램 |
| `supabase` | 데이터베이스 마이그레이션과 `game-api` Edge Function |
| `packages/*` | 웹·확장 프로그램이 함께 쓰는 계약, 게임 규칙, URL 처리 코드 |

현재 구현·검증·남은 작업은 [진행 현황](docs/진행현황.md)에서 확인할 수 있습니다.

## 요구 사항

- Node.js 22 이상
- pnpm 10.26.1
- Chrome 또는 Chromium 계열 브라우저
- Supabase 프로젝트
- 로컬 Supabase를 실행하려면 Docker Desktop, OrbStack 등의 컨테이너 런타임과 Supabase CLI

## 로컬 빌드와 실행

### 1. 의존성 설치

```bash
corepack enable
corepack prepare pnpm@10.26.1 --activate
pnpm install --frozen-lockfile
```

### 2. 환경 변수 설정

웹과 확장 프로그램은 같은 Supabase 프로젝트를 바라봐야 합니다. 공개 가능한 프로젝트 URL과 Publishable key만 각 앱에 넣습니다.

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/extension/.env.example apps/extension/.env.local
```

`apps/web/.env.local`

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

`apps/extension/.env.local`

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_WEB_APP_URL=http://localhost:3000
```

`PAIRING_CODE_SECRET`는 수동 코드와 자동 연결 nonce 모두에 사용하므로 **클라이언트 환경 변수에 넣지 않습니다.** 서버의 Edge Function 시크릿으로만 설정합니다.

### 3. 웹 앱 실행

```bash
pnpm dev:web
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

### 4. 확장 프로그램 빌드·로드

개발 중 자동 빌드를 유지하려면 다음 명령을 별도 터미널에서 실행합니다.

```bash
pnpm dev:extension
```

한 번만 빌드하려면 다음을 사용합니다.

```bash
pnpm --filter @wikirunner/extension build
```

Chrome에서 `chrome://extensions`를 열고 다음 순서로 로드합니다.

1. 우측 상단의 **개발자 모드**를 켭니다.
2. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
3. `apps/extension/dist` 폴더를 선택합니다.
4. 코드 또는 환경 변수를 바꾼 뒤에는 해당 페이지에서 확장 프로그램을 **새로고침**합니다.

### 5. 검사와 프로덕션 빌드

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

## 로컬 Supabase 실행 (선택)

원격 개발 프로젝트를 바로 사용해도 됩니다. 로컬 DB와 Edge Function이 필요할 때만 아래를 수행합니다.

```bash
supabase start
supabase db reset
cp supabase/functions/.env.example supabase/functions/.env.local
supabase functions serve game-api --env-file supabase/functions/.env.local
```

`supabase start` 출력의 API URL과 Publishable key를 앞서 만든 두 `.env.local` 파일에 넣습니다. 로컬에서 Edge Function을 띄운 경우에도 웹과 확장 프로그램은 일반적으로 `http://127.0.0.1:54321` API URL을 사용합니다.

작업 종료 시에는 아래 명령으로 로컬 컨테이너를 멈춥니다.

```bash
supabase stop
```

## 이용 방법

1. 웹 앱에서 익명으로 접속한 뒤 **새 방 만들기** 또는 초대 코드로 방에 참가합니다.
2. 방장이 시작·목표 문서를 직접 설정하거나, 연결한 확장 프로그램에서 난이도를 고르고 랜덤 경로를 추첨합니다.
3. 각 참가자는 **확장 프로그램 연결**을 눌러 같은 브라우저 프로필에 설치된 Chrome 확장 프로그램을 자동으로 연결합니다.
4. 모든 참가자가 **준비 완료**를 누르면 호스트가 10초 카운트다운을 시작합니다.
5. 카운트다운이 끝나면 확장 프로그램이 시작 문서를 연 전용 나무위키 탭을 만듭니다.
6. 해당 탭에서 본문 내부 링크를 따라 목표 문서로 이동합니다. 확장 프로그램이 이동 횟수와 시간을 기록합니다.
7. 목표 문서에 도착하면 웹의 리더보드에서 결과를 확인합니다.

경기 중 포기하려면 확장 프로그램 팝업에서 **이번 경기 포기**를 누릅니다. 완주·포기·실격 뒤 확장 프로그램은 다음 경기 대기 상태로 돌아갑니다.

### 게임 규칙과 주의 사항

- 나무위키 본문 안의 문서 링크를 사용합니다.
- 주소를 직접 입력하거나 새 탭에서 목표 문서를 여는 방식은 허용되지 않습니다.
- 경기용으로 자동으로 열린 나무위키 탭에서 플레이합니다.
- 확장 프로그램이 꺼져 있거나 권한이 해제되면 이동 기록이 누락될 수 있습니다.

## 운영 배포

운영 배포는 **Supabase(데이터·API) → 웹 앱 → 확장 프로그램** 순서로 진행합니다. 아래 명령에서 `<project-ref>`와 값은 실제 운영 프로젝트 값으로 바꿉니다.

### 1. Supabase 프로젝트 준비

Supabase 대시보드에서 새 프로젝트를 만들고, Authentication 설정에서 Anonymous Sign-Ins를 활성화합니다. 웹 서비스 도메인이 정해지면 다음도 설정합니다.

- **Site URL**: 운영 웹 주소
- **Redirect URLs**: 운영 웹 주소와 필요한 미리보기 주소
- 익명 로그인 남용 방지: CAPTCHA 또는 Turnstile 등 적용

CLI에서 프로젝트를 연결한 뒤 마이그레이션을 반영합니다.

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

### 2. Edge Function 배포

페어링 코드를 서명할 32자 이상의 무작위 비밀값을 만들고, 원격 시크릿으로만 등록합니다. 이 값은 저장소, 웹 호스팅 환경 변수, 확장 프로그램에 넣으면 안 됩니다.

```bash
supabase secrets set PAIRING_CODE_SECRET='<32자_이상의_무작위_비밀값>'
supabase functions deploy game-api
```

배포 후 Supabase 대시보드 또는 CLI로 `game-api`가 활성 상태인지 확인합니다. 함수는 JWT 검증을 사용하므로 익명 로그인 세션을 가진 웹·확장 프로그램 요청만 처리합니다.

### 3. 웹 앱 배포

Next.js를 지원하는 호스팅(Vercel 등)에 저장소를 연결하고, 빌드 명령을 아래처럼 설정합니다.

```bash
pnpm --filter @wikirunner/web build
```

호스팅 환경 변수에는 아래 두 항목만 설정합니다.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

배포가 끝난 뒤 운영 도메인을 Supabase Auth의 Site URL·Redirect URLs에 반영하고, 실제 운영 주소에서 방 생성과 익명 로그인을 확인합니다.

확장 프로그램을 빌드할 때는 `VITE_WEB_APP_URL`에도 이 운영 주소를 설정합니다.

### 4. Chrome 확장 프로그램 배포

운영 Supabase 값을 넣은 `apps/extension/.env.local`로 확장 프로그램을 다시 빌드합니다.

```bash
pnpm --filter @wikirunner/extension build
```

Chrome Web Store 제출용 ZIP은 다음 명령으로 만듭니다. 결과 파일은
`apps/extension/wikirunner-extension.zip`입니다.

```bash
pnpm --filter @wikirunner/extension package
```

제출 전에는 다음을 확인합니다.

- `apps/extension/public/manifest.json`의 버전을 올렸는지
- 운영 Supabase URL만 포함되는지
- 개인정보 처리 안내와 권한 사용 사유를 준비했는지
- 웹 배포본과 확장 프로그램이 같은 Supabase 프로젝트를 바라보는지

### 5. 배포 후 점검

최소 두 계정 또는 두 브라우저 프로필로 아래 흐름을 확인합니다.

1. 방 생성과 참가
2. 양쪽 확장 프로그램 페어링
3. 준비·카운트다운·전용 탭 생성
4. 나무위키 페이지 이동 감지와 목표 도착
5. 순위 표시, 경기 포기, 종료 후 대기 상태 복귀

개발 중 생성된 익명 사용자·테스트 방 데이터는 공개 전 정리합니다.

## 문서

- [기획서](docs/기획서.md)
- [아키텍처](docs/아키텍처.md)
- [진행 현황 및 QA](docs/진행현황.md)
- [아키텍처 결정 기록](docs/adr)

## 보안

- `.env.local`과 Edge Function 시크릿은 Git에 올리지 않습니다.
- Publishable key는 공개 클라이언트 설정용이며, Supabase 서비스 역할 키(service role key)는 웹·확장 프로그램에 절대 넣지 않습니다.
- 운영 전에는 익명 로그인 속도 제한과 봇 방지 정책을 반드시 검토합니다.
