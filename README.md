# AdMate Vision (Ad Vision DA)

**디지털 광고 게재면 자동 캡처 솔루션**

이 프로젝트는 뉴스 기사나 웹페이지의 특정 광고 영역(GDN 등)을 타겟 광고 소재로 교체하여 스크린샷을 찍고, 결과물을 저장/관리하는 자동화 시스템입니다.

---

## 🛠 기술 스택 (Tech Stack)

- **Framework**: [Next.js 14](https://nextjs.org/) (App Router)
- **Backend/Database**: [Supabase](https://supabase.com/) (Auth, Database, Storage)
- **Engine**: [Puppeteer Core](https://pptr.dev/) + [@sparticuz/chromium](https://github.com/Sparticuz/chromium) (Serverless 호환 브라우저 자동화)
- **Image Processing**: [Sharp](https://sharp.pixelplumbing.com/)

---

## 🚀 시작하기 (Getting Started)

### 1. 전제 조건 (Prerequisites)

- Node.js 18.17 이상
- Supabase 프로젝트 (Database & Storage 버킷)

### 2. 설치 (Installation)

```bash
npm install
# 또는
yarn install
```

### 3. 환경 변수 설정 (Environment Setup)

프로젝트 루트에 `.env.local` 파일을 생성하고 다음 변수를 설정하세요.

```ini
# Supabase 설정 (필수)
NEXT_PUBLIC_SUPABASE_URL="https://your-project-id.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# 로컬 개발 환경 설정 (필수)
# true일 경우 로컬 크롬을 사용하며, false일 경우 서버리스용 chromium을 사용합니다.
IS_LOCAL="true" 

# (옵션) 프록시 설정
PROXY_HOST=""
PROXY_PORT=""
PROXY_USER=""
PROXY_PASS=""
```

### 4. 실행 (Running)

```bash
# 개발 서버 실행
npm run dev

# 프로덕션 빌드 및 실행
npm run build
npm start
```

---

## 📂 프로젝트 구조 (Structure)

```
src/
├── app/
│   └── api/
│       └── captures/       # 캡처 요청 및 조회 API
│           └── execute/    # (내부용) 캡처 엔진 실행 API
├── lib/
│   ├── capture/            # Puppeteer 캡처 로직 (Engine)
│   └── supabase/           # Supabase 클라이언트 및 타입 정의
└── ...
```

## 📦 배포 (Deployment)

이 프로젝트는 **Vercel** 또는 **AWS Lambda** 환경에 최적화되어 있습니다.
Puppeteer 용량 제한을 피하기 위해 `@sparticuz/chromium`을 사용하며, 배포 시 `IS_LOCAL="false"`로 설정해야 합니다.

---

## 🔗 API 문서

자세한 API 사용법은 [API_REFERENCE.md](./API_REFERENCE.md) 문서를 참고하세요.
