# Therapeutic Garden QA

Spring Boot Therapeutic Garden 서비스를 브라우저에서 확인하는 Playwright QA 프로젝트입니다. 관리자 주요 화면을 읽기 전용으로 점검하고, 로컬 개발 서버에서는 Site·HC·HS 및 HS 이미지 CRUD 흐름을 검증합니다.

## 자동화 범위

- 관리자 로그인 및 Monitoring
- HS 상세 및 Gallery 이미지 전환
- Map Modal, 관리자 Navigation
- Site / HC / HS 목록과 상세 조회
- Site CRUD, HC CRUD, HS CRUD
- HS 이미지 업로드·대표 이미지·순서 변경·삭제

## 설치

```sh
npm install
npx playwright install
```

환경은 `.env.example`을 참고해 `.env`에 설정합니다.

```dotenv
BASE_URL=http://localhost:8080
ADMIN_LOGIN_ID=
ADMIN_PASSWORD=
```

`.env`에는 비밀번호가 들어갈 수 있으므로 Git에 올리지 않습니다. `.env.example`만 커밋합니다.

## 실행

| 명령 | 용도 |
| --- | --- |
| `npm test` | 전체 기본 QA (read-only + local CRUD) |
| `npm run test:headed` | 전체 QA를 브라우저 창으로 실행 |
| `npm run test:readonly` | read-only QA만 실행 |
| `npm run test:crud` | CRUD 및 이미지 관리 QA만 실행. localhost에서만 실행 |
| `BASE_URL=https://서비스주소 ADMIN_LOGIN_ID=아이디 ADMIN_PASSWORD=비밀번호 npm run test:production` | Production 원격 주소에 read-only QA만 실행 |
| `npm run typecheck` | TypeScript 검사 (`tsc --noEmit`) |
| `npm run test:report` | 마지막 HTML report 열기 |

Production 실행은 `BASE_URL`을 반드시 지정해야 하며 localhost 주소와 URL 내 인증정보를 거부합니다. Production 설정에는 read-only project만 포함합니다. read-only 테스트는 로그인 POST만 허용하고 그 외 변경 요청을 차단합니다. CRUD fixture도 localhost, 127.0.0.1, [::1]에서만 실행되므로 원격 환경에서는 skip됩니다.

## 테스트 분류와 안전장치

Playwright project가 테스트 파일로 분류합니다. `login`, `monitoring`, `healing-spot`, `map`, `navigation`, `smoke`는 read-only입니다. `site-crud.spec.ts`는 local CRUD / 이미지 관리 테스트입니다. 실행할 때마다 `[QA]` 이름을 가진 전용 데이터를 만들고, 현재 실행에서 생성한 데이터만 정리합니다.

## 실패 분석

실패한 테스트의 screenshot, trace, video와 실행 문맥은 `test-results/`에 저장됩니다. 성공한 테스트에는 이 대용량 파일을 보관하지 않습니다. HTML report는 `playwright-report/`에 생성되며 `npm run test:report`로 확인합니다. Playwright trace는 report의 실패 테스트에서 열거나 다음 명령으로 직접 볼 수 있습니다.

```sh
npx playwright show-trace test-results/<실패 테스트 폴더>/trace.zip
```

공통 fixture는 `console.error`와 `pageerror`를 수집해 `browser-errors` 첨부로 report에 남깁니다. 브라우저 JS 오류는 테스트를 실패시킵니다. SDK의 warning은 오류로 취급하지 않으며, favicon 및 외부 resource의 실패 메시지는 수집해 참고용으로 첨부하지만 실패 조건으로 삼지 않습니다.

## 향후 계획

- Participant QA 추가
- Spatial Layout QA 추가
- 자연어 기반 Playwright MCP / AI Agent 연동
