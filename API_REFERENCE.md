# AdMate Vision (Ad Vision DA) API 문서

**캡처 요청 및 조회 자동화 API 명세**

API 엔드포인트는 `http://[호스트]/api/captures`입니다.

---

## 1. 캡처 요청 (POST /api/captures)

새로운 캡처 작업을 생성하고, 백그라운드 엔진에게 작업을 즉시 실행하도록 요청합니다.

- **URL**: `POST /api/captures`
- **Content-Type**: `application/json`

### 요청 (Request)

| 필드 | 타입 | 설명 | 필수 여부 |
| :--- | :--- | :--- | :--- |
| **channel** | `string` | 광고 매체 유형 (`gdn` 또는 `youtube`) | **Yes** |
| **publisherUrl** | `string` | 캡처할 광고 게재면 URL | **Yes** |
| **creativeUrl** | `string` | 대체할 광고 소재 이미지 URL | **Yes** |
| **captureLanding** | `boolean` | `true`일 경우 광고 클릭 후 랜딩 페이지까지 캡처 | **No** (기본: `false`) |
| **metadata** | `object` | 분석용 추가 정보 (임의 형식) | **No** |

**Example**:

```json
{
  "channel": "gdn",
  "publisherUrl": "https://www.yna.co.kr/view/AKR20240101000100001",
  "creativeUrl": "https://via.placeholder.com/300x250.png/006400/ffffff?text=AdMate+Vision+Test",
  "captureLanding": false,
  "metadata": {
    "execution_type": "manual"
  }
}
```

### 응답 (Response)

- **Status Code**: `200 OK`

```json
{
  "success": true,
  "captureId": "8494c080-502f-4f3a-a951-cc4da5b31c01",
  "message": "Capture request created successfully",
  "status": "pending",
  "data": { ... } // Supabase DB row details
}
```

---

## 2. 캡처 목록 조회 (GET /api/captures)

저장된 모든 캡처 기록을 조회합니다. 필터링 조건을 추가할 수 있습니다.

- **URL**: `GET /api/captures`

### 쿼리 파라미터 (Query Params)

| 파라미터 | 설명 | 기본값 |
| :--- | :--- | :--- |
| **id** | 특정 캡처 ID만 조회 | - |
| **campaignId** | 특정 캠페인 ID에 속한 캡처만 조회 | - |
| **channel** | 매체별 필터링 (`gdn`, `youtube` 등) | - |
| **status** |  상태값 (`pending`, `processing`, `completed`, `failed`) | - |
| **limit** | 반환할 최대 행 개수 | 10 |

**Example**:

```bash
curl "http://localhost:3000/api/captures?channel=gdn&status=completed&limit=5"
```

### 응답 (Response)

- **Status Code**: `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "8494c080-502f-4f3a-a951-cc4da5b31c01",
      "channel": "gdn",
      "status": "completed",
      "source_url": "https://www.yna.co.kr...",
      "placement_image_url": "https://[bucket-url]/captures/[uuid].png",
      "captured_at": "2024-02-11T12:34:56.789Z",
      ...
    }
  ]
}
```

---

## 3. (내부용) 캡처 실행 (POST /api/captures/execute)

`POST /api/captures` 요청 시 내부적으로 호출되는 엔진 엔드포인트입니다.
직접 호출하는 일은 거의 없으나 디버깅용으로 사용할 수 있습니다.

- **URL**: `POST /api/captures/execute`
- **Body**: `{ "id": "캡처ID" }`

---

## ⚠️ 에러 처리 (Error Handling)

API 호출 시 문제가 발생하면 JSON 응답의 `success: false`와 `error` 필드로 원인을 확인할 수 있습니다.

```json
{
  "success": false,
  "error": "NEXT_PUBLIC_SUPABASE_URL not configured"
}
```

- **500 Internal Server Error**: 서버 설정 누락, DB 연결 실패 등
- **400 Bad Request**: 필수 파라미터 누락
- **404 Not Found**: 존재하지 않는 페이지 캡처 시도 등

---
**문서 작성일**: 2026-02-11
