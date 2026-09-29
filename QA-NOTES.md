# 관리자 조회 QA (1단계)

IntelliJ에서 manage를 실행한 후 QA 프로젝트에서 실행합니다.

```sh
npx playwright test
npx tsc --noEmit
npx playwright test tests/healing-spot.spec.ts tests/map.spec.ts --headed
```

- 기존 smoke/login/monitoring 3개 + HS 상세/Gallery 2개 + 지도 1개 + navigation 5개 = 11개.
- `loginAsAdmin`을 그대로 재사용합니다. 기존 11개 조회 테스트는 서버 시작/종료나 데이터 CRUD를 수행하지 않습니다.
- 기본 선택 Site에 모니터링 이미지와 배치된 HS가 있어야 합니다. 목록 조회 경로에는 기존 Site/HC/HS가 필요합니다.
- HS는 실제 Canvas의 `상세 보기` 버튼 중 하나를 선택합니다. DB ID나 HS 코드는 고정하지 않습니다.
- 상세 GET 응답 후 Gallery 상태 메시지가 비워질 때까지 기다립니다. 이미지 URL뿐 아니라 visible/complete/naturalWidth도 검증합니다.
- 이미지 0개는 등록 이미지 없음 상태, 1개는 단일 이미지와 숨겨진 Thumbnail 영역을 검증합니다. 2개 이상이면 선택되지 않은 Thumbnail을 클릭해 큰 이미지 URL과 로딩 완료를 확인합니다.
- 이미지/API 오류를 정상 이미지 없음으로 취급하지 않습니다. 오류가 발생하면 테스트는 실패하며 기존 trace/screenshot 설정으로 진단합니다. 이미지 0/1개 및 오류 상태를 위한 별도 데이터 생성이나 응답 mock은 하지 않습니다.
- Navigation: 관리자 메인에서 사이트/참가자/일정/달력 메뉴, Site → HC → HS 목록/상세 링크를 클릭해 HTTP 200, URL, 제목을 확인합니다. 달력 내부 SDK 렌더링은 이 smoke 범위 밖입니다.

## 지도 Marker 범위

2026-09-28 실제 headless DOM을 확인했습니다. Marker는 이름/제목이 없는 `role="presentation"` 이미지와 SDK가 만든 `daum.maps.Marker.Area:N`의 `map/area` 조합입니다. 앱 소유의 안정적인 식별자가 없으므로 이미지 URL, 생성 ID, 픽셀 좌표에 의존하는 클릭은 고정 테스트에 넣지 않았습니다. 지도 dialog와 `#map` 표시 및 닫기/포커스 복귀만 검증합니다. 지도 타일/Marker 로딩 성공을 보장하는 테스트는 아닙니다.

headed 수동 점검: 지도 Marker 클릭 → 해당 HS 상세 Modal, Gallery 이미지 전환, 이미지 없음/오류 안내.
Site CRUD의 전용 데이터와 정리/복구 기준은 아래를 따릅니다.

## Site CRUD QA (local 전용)

```sh
npx playwright test                       # 기존 조회 11개 + Site/HC/HS CRUD 각 1개 + HS 이미지 1개
npx playwright test tests/site-crud.spec.ts
npx playwright test --grep-invert @crud   # 기존 read-only 테스트만 실행
npx tsc --noEmit
```

- `playwright.config.ts`, `loginAsAdmin`, 기존 조회 테스트를 그대로 사용합니다. IntelliJ의 localhost:8080 서비스가 실행 중이어야 하며 서버를 시작하거나 종료하지 않습니다.
- Site 시나리오가 등록 → 이름 수정 → 목록으로 이동 → 상세/수정 화면 재진입 → 삭제를 검증합니다. HC/HS CRUD, 이미지, 대표 이미지, Spatial, Participant 기능은 조작하지 않습니다.
- 이름은 `[QA] Site ${Date.now()}-${randomUUID()}`이며 수정명에 ` 수정`만 추가합니다. retry/worker/반복 실행마다 새 이름입니다. 이름은 실행 결과의 `qa-site` annotation에 기록됩니다.
- 최초 목록의 모든 Site 링크(ID)와 행 텍스트(이름/주소)를 보관합니다. 조작 대상은 이번 실행의 정확한 이름과 생성 ID로 한정하고, 삭제 전 기존 ID가 아님을 확인합니다. 삭제 후 기존 행이 그대로 존재하는지 검증합니다. 다른 실행 또는 이전 실패 실행의 `[QA]` 데이터는 일괄 삭제하지 않습니다.
- 실제 UI에서 확인한 등록 필드는 사이트명(required), 주소(readonly/required), 지도 레벨(required, 기본 3)입니다. 실제 Kakao 우편번호 iframe에서 공공 주소 `서울 중구 세종대로 110 (서울특별시청)`를 선택하고, 주소 및 숨겨진 위도/경도 값이 설정된 뒤 저장합니다. DOM 값 강제 주입/주소 mock/이미지 업로드는 하지 않습니다.
- SDK 준비 상태와 Playwright assertion으로 기다립니다. 외부 우편번호/지도/지오코딩 서비스의 네트워크 또는 DOM 변경은 테스트 실패 요인입니다. 이 외부 서비스의 가용성을 mock으로 숨기지 않습니다.
- 수정은 QA Site 이름만 바꿉니다. 저장 후 새 목록 GET → 변경 이름의 상세 → 수정 화면에서 이름/주소/지도 레벨 유지 여부를 검증합니다.
- Local 보호는 CRUD 파일에만 적용합니다. URL 파싱 후 `http:`/`https:` 및 정확한 host `localhost`, `127.0.0.1`, `[::1]`만 허용합니다. 사용자 정보가 있는 URL, 유사 도메인, Railway/Production URL은 로그인/페이지 요청 전에 skip합니다. context route는 원래 local origin 밖으로 가는 최상위 navigation 및 변경 요청도 차단합니다. 변경 경로는 관리자 로그인, 현재 실행의 등록, 소유 확인한 ID의 수정/삭제로 제한합니다. 조회 테스트에는 이 보호 장치를 적용하지 않습니다.
- 등록 제출 직전에 cleanup 필요 상태를 설정하므로 응답 유실도 복구 대상입니다. 시나리오 삭제 및 fixture teardown 모두 정확한 등록명/수정명만 찾고, 같은 ID의 삭제 form과 확인창 메시지를 확인한 뒤 UI로 삭제합니다. 삭제 후 다시 GET하여 부재를 확인합니다.
- Fixture teardown에는 별도 60초 제한이 있습니다. 새 페이지에서 기존 helper로 로그인한 후 정리합니다. 원래 테스트가 실패했으면 cleanup 오류를 첨부/로그로 남겨 원인을 보존합니다. 시나리오가 성공했는데 cleanup만 실패하면 테스트도 실패합니다.
- 프로세스 강제 종료, 서버 중단, 세션/SDK 오류 등으로 cleanup을 완료하지 못하면 QA Site가 남을 수 있습니다. 해당 실행의 `qa-site` annotation 또는 `site-cleanup-error` 첨부에서 정확한 이름을 찾아 localhost 관리자 목록에서 ID와 이름을 확인한 뒤 수동으로 삭제합니다. 이름 prefix만으로 일괄 삭제하지 않습니다.
- Local URL 보호는 연결 대상 DB까지 판별하지 못합니다. 로컬 서비스가 테스트용 DB를 사용하는지 실행자가 확인해야 합니다. 기존 Site 유지 검증 범위는 목록의 ID/이름/주소이며 DB 전체 무변경 증명은 아닙니다. 검증 중 다른 사용자가 기존 Site를 변경하면 비교가 실패할 수 있습니다.

### 2026-09-28 검증 결과

- 전체 12개 통과: 기존 read-only 11개 + Site CRUD 1개.
- `npx tsc --noEmit` 통과.
- Railway BASE_URL로 Site CRUD 실행: 1 skipped (로그인/CRUD 요청 없음).
- 임시 검증 시나리오에서 수정 저장·재진입 뒤 의도적으로 오류 발생: 원래 오류가 실패 원인으로 유지되고 teardown 정리 완료. 임시 검증 파일은 제거했습니다.
- 전체 실행 종료 후 별도 로그인/목록 GET 확인: `[QA] Site` 잔여 0개, 기존 `디에이치 방배` 유지.

## Healing Course CRUD QA (local 전용)

```sh
npx playwright test tests/site-crud.spec.ts                  # Site + HC 시나리오
npx playwright test tests/site-crud.spec.ts --grep '내부 HC'   # HC 시나리오만
```

- 같은 spec에 독립적인 HC 시나리오 1개를 추가했습니다. 기존 Site 등록 helper와 fixture의 local 보호/정리를 재사용합니다. 기본 순차 모드를 명시하여 두 시나리오의 임시 Site가 서로의 기존 데이터 스냅샷에 포함되는 것을 피합니다. 기존 read-only 테스트와 설정/로그인 helper는 변경하지 않습니다.
- 매 실행 UI로 전용 Site를 만든 뒤 그 Site에서만 HC를 등록합니다. Site는 기존 timestamp + UUID 이름 방식이며, HC도 별도 timestamp + UUID를 사용해 `[QA] Course …`, 코드 `QA-HC-…`를 만듭니다. `qa-site`/`qa-course` annotation에 이름과 코드를 남깁니다.
- 실제 HC 등록 UI 필수값: 사이트 선택, HC 코드, 코스명. 반경과 지도 중심은 선택 사항이라 조작하지 않습니다. `QA Site 상세 → HC 관리 → HC 등록` 순서로 진입하고 선택된 Site ID/이름을 확인한 뒤 제출합니다.
- 수정은 생성한 HC의 코스명에 ` 수정`을 붙이는 것만 수행합니다. 실제 수정 저장은 해당 Site의 HC 목록으로 돌아옵니다. 목록에서 변경 이름 확인 후 별도 목록 GET → 상세 → 수정 화면에서 이름/코드/소속 Site 값이 유지되는지 확인합니다.
- 기존 Site 각각의 HC 목록을 읽기 전용으로 기록하고, HC 삭제 후 기존 목록의 개수 및 각 행의 ID/이름/코드/반경이 유지되는지 비교합니다. 전체 DB/HS 속성의 무변경을 증명하는 검사는 아닙니다.
- 쓰기 요청은 기존 local-origin 보호에 더해, 소유한 Site/HC 경로에만 허용합니다. HC 등록/수정 POST는 `siteId`, 고유 코드, 이번 실행의 정확한 이름도 검사합니다. 기존 Site 안으로 잘못 제출되는 요청은 브라우저 route에서 차단합니다. HC가 아닌 다른 변경 경로(HS/이미지/Spatial 포함)는 허용하지 않습니다.
- 정상 시나리오에서 HC를 삭제하고, fixture teardown에서 HC 부재를 다시 확인한 뒤 Site를 삭제합니다. 실패해도 같은 순서입니다. HC ID를 확보하기 전에 실패했으면 이번 실행의 정확한 이름 + 코드 + QA Site 소속으로 찾아 정리합니다. 기존 HC ID와 일치하면 삭제하지 않습니다.
- HC 삭제 확인창과 해당 ID의 form을 확인하며 삭제 후 새 GET에서 이름/코드/ID가 없고 부모 Site의 HC 목록이 비었는지 검사합니다. 알 수 없는 HC가 남거나 자식 정리 확인이 실패하면 부모를 삭제하지 않습니다. 무관한 이전 실행의 QA 데이터는 정리하지 않습니다.
- cleanup 실패는 `site-cleanup-error` 첨부와 로그에 Site/HC 이름을 함께 남깁니다. 원래 시나리오 실패를 보존하고 cleanup만 실패하면 테스트를 실패시킵니다. 강제 종료/서버 장애 시 annotation의 정확한 Site/HC 이름·코드·ID를 대조하여 HC → Site 순서로 수동 복구합니다.
- 기존 Site QA의 외부 주소 SDK 의존성과 로컬 서비스의 DB 연결 확인 필요성은 그대로입니다. 다른 테스트 프로세스/사용자가 기존 데이터를 동시에 바꾸면 baseline 비교가 실패할 수 있으므로 동일 DB에서 CRUD QA를 중복 실행하지 않습니다.
- HS CRUD, 이미지 CRUD, Spatial Layout, manage 코드 변경은 포함하지 않습니다.

### HC 추가 후 검증 결과 (2026-09-28)

- 전체 Playwright 13개 통과: read-only 11 + Site CRUD 1 + HC CRUD 1.
- `npx tsc --noEmit` 통과.
- Railway BASE_URL 검증: Site/HC 2개 모두 skipped.
- 임시 오류 주입 2건(등록 저장 후 HC ID 확보 전 / 수정 저장·재진입 후): 의도한 원래 오류만 실패로 남고 HC → Site cleanup 성공. 검증용 임시 파일은 제거했습니다.
- 종료 후 별도 로그인으로 재조회: QA Site/Course 잔여 0개. 기존 Site `디에이치 방배` 및 HC-A 회복 코스 / HC-B 감각 코스 / HC-C 힐링 코스 유지.

## Healing Spot CRUD QA (local 전용)

```sh
npx playwright test tests/site-crud.spec.ts                  # Site / HC / HS 시나리오
npx playwright test tests/site-crud.spec.ts --grep '내부 HS'   # HS 시나리오만
```

- 독립적인 HS 시나리오 1개를 같은 spec에 추가했습니다. 기존 HC 생성 부분을 `createOwnedCourse`로 추출해 Site → HC 생성과 기존 HC 목록 기록을 재사용합니다. 세 CRUD 시나리오는 같은 파일에서 순차 실행합니다.
- 매 실행 전용 QA Site → QA Course → QA Spot을 UI로 생성합니다. HS 이름은 `[QA] Spot ${timestamp}-${UUID}`, 코드는 `QA-HS-${timestamp}-${UUID}`이며 `qa-spot` annotation에 기록합니다. 소속 코스의 ID/선택 이름과 상세의 Site/HC 링크를 확인합니다.
- 실제 등록 필수값은 소속 코스, HS 코드, 스팟명, 위도/경도입니다. 위도/경도는 hidden이며 HTML `required`는 없지만, 비워서 제출하면 서버가 `지도를 클릭해 스팟의 위치를 지정해 주세요.` 오류를 반환하는 것을 확인했습니다. 등록 폼의 `HealingSpot 위치 설정` 지도 SDK가 렌더링되면 지도를 클릭하여 좌표를 설정합니다. 숨겨진 필드 강제 주입은 하지 않습니다. 이는 등록 필수 지리 좌표이며 별도의 Spatial Layout/이미지 위 Spot 배치는 조작하지 않습니다.
- 수정은 생성한 HS의 스팟명만 변경합니다. 별도 HC 상세 → HS 목록 GET → HS 상세 → 수정 화면으로 재진입하여 변경 이름, 고유 코드, 소속 코스, 최초 등록 좌표 유지 여부를 검증합니다.
- 기존 모든 HC의 HS 목록을 읽기 전용으로 보관하고, 삭제 후 목록의 개수/ID/이름/코드가 그대로인지 비교합니다. 기존 HS의 이미지/전체 DB 속성 무변경을 증명하는 검사는 아닙니다.
- Local-only 보호는 기존과 동일합니다. HS 등록/수정 multipart POST도 파싱해 현재 실행의 `courseId`/고유 코드/정확한 이름만 허용하며 비어 있지 않은 파일 업로드를 차단합니다. 삭제 경로는 이름·코드·부모 관계까지 확인한 이번 실행의 HS ID만 허용합니다. 다른 Site/HC/HS 및 이미지/Spatial 변경 경로는 허용하지 않습니다.
- 정상 시나리오에서 HS 삭제 후 새로운 HC 상세/HS 목록 조회로 QA Course 유지와 HS 부재를 확인합니다. fixture가 HS 부재를 다시 확인한 뒤 HC → Site 순서로 삭제합니다. 실패해도 동일 순서로 정리하며 자식 삭제 확인 실패 시 부모 삭제를 진행하지 않습니다.
- 등록 제출 직전에 cleanup 플래그를 설정합니다. HS ID를 확보하기 전에 실패해도 이번 실행의 정확한 이름 + 코드 + QA HC/Site 관계로 찾아 정리합니다. 무관한 `[QA]` 데이터는 삭제하지 않습니다. cleanup 오류에는 Site/HC/HS 이름을 모두 첨부하고 원래 테스트 오류를 보존합니다.
- SDK/네트워크 장애, 강제 종료, 서버 중단은 정리 실패 요인입니다. 남은 데이터는 annotation과 `site-cleanup-error`의 정확한 이름/코드/ID를 확인해 HS → HC → Site 순서로 수동 정리합니다. 로컬 서비스의 테스트 DB 연결 여부는 실행자가 확인해야 합니다.
- 이미지 업로드/대표·순서·삭제, Spatial Image/Spot 배치, Participant, manage 코드 변경은 수행하지 않습니다.

### HS 추가 후 검증 결과 (2026-09-28)

- 전체 Playwright 14개 통과: read-only 11 + Site/HC/HS CRUD 각 1개.
- Railway BASE_URL: CRUD 3개 모두 skipped.
- `npx tsc --noEmit` 통과.
- 등록 후 HS ID 확보 전 / 수정 저장·재진입 후 의도적 실패 2건: 원래 오류 보존, HS → HC → Site cleanup 성공. 임시 검증 파일은 제거했습니다.
- 전체 실행 후 별도 로그인으로 전체 계층 재조회: QA Site/HC/HS 잔여 0개. 기존 Site 1개, HC 3개, HS 6개(HS1~HS6) 유지.

## HS 이미지 관리 QA

- `tests/site-crud.spec.ts`의 전용 시나리오가 기존 Site → HC → HS 생성 helper를 재사용합니다. 이미지 동작은 `utils/spot-images.ts`에 둡니다.
- `fixtures/images/qa-red.png`, `qa-green.png`, `qa-blue.png`: 직접 생성한 48×48 RGB PNG, 각 123–124바이트. 외부/실제 서비스 이미지를 사용하지 않습니다.
- 실제 편집 UI의 `새 이미지 추가` input에 `setInputFiles()`로 3장을 선택합니다. 대표/순서/삭제는 모두 임시 편집 상태이며 `HS 수정` 제출 후 저장됩니다.
- 업로드 후 상세로 이동했다가 수정 화면에 재진입하고, 이미지 로딩과 서버 content 응답 바이트가 fixture와 일치하는지 확인합니다.
- 파란 이미지를 대표로 지정하고 저장·재진입하여 대표 배지/버튼 비활성화를 확인합니다. 초록 이미지의 `위로 이동` 버튼으로 순서를 변경하고 저장·재진입 후 순서를 검증합니다.
- 일반 이미지 삭제 후 나머지 이미지 유지, 대표 이미지 삭제 후 남은 첫 이미지가 대표가 되는 서비스 규칙을 검증합니다.
- Monitoring은 QA Site 선택 후 모니터링 이미지 미설정 상태를 검사합니다. 대표 이미지의 실제 Canvas 표시 검증에는 Site 모니터링 이미지와 저장된 HS 배치가 필요하며 이번 작업에서는 생성하지 않습니다.
- Local-only 보호를 유지합니다. 이미지 업로드는 소유한 HS 수정 POST에서만 허용하고 fixture 이름/실제 바이트/PNG 형식을 검사합니다. imageOrder/imageDeleted/imageRepresentative의 기존 ID는 해당 HS에서 소유 확인한 ID만 허용하며 imageSpatial은 비어 있어야 합니다.
- cleanup은 이미지 → HS → HC → Site 순서입니다. 실패 시에도 소유 HS에서 정확한 파일명/바이트를 재확인해 이미지 ID를 복구합니다. 이미지 정리 실패 시 부모 삭제를 진행하지 않으며 원래 테스트 실패는 보존합니다.
- 삭제 완료는 수정 화면에서 목록이 비었는지와 관찰한 모든 이미지 content URL의 404/410 응답으로 검증합니다. S3 등 저장소의 물리 객체 삭제까지 직접 조회하는 검사는 아닙니다.
- 기존 데이터 생성 helper에는 HS 등록 필수 좌표를 위한 지도 클릭이 포함됩니다. 이미지 관리 자체에는 지도/Spatial 편집을 추가하지 않습니다.

### 이미지 QA 검증 결과 (2026-09-28)

- 사용자 승인에 따라 기존 HS 생성 helper의 지도 클릭은 필수 좌표 입력 setup에만 사용했습니다. Kakao 렌더링/Marker/SDK에 대한 별도 테스트는 추가하지 않았습니다.
- 전체 Playwright 15개 통과: read-only 11 + Site/HC/HS CRUD 3 + HS 이미지 관리 1.
- Railway BASE_URL: 변경 테스트 4개 모두 skipped.
- `npx tsc --noEmit`, `git diff --check` 통과.
- 실제 실행에서 input보다 편집 이벤트 연결이 늦는 경우를 확인하여 스크립트가 삽입하는 alert DOM이 준비된 뒤 업로드하도록 수정했습니다. 임의 시간 대기는 사용하지 않습니다.
- 업로드 저장 직후 이미지 ID 확보 전에 의도적 오류를 주입: 원래 오류 보존, 파일명/바이트로 ID 복구 후 이미지 → HS → HC → Site cleanup 성공. 임시 검증 파일 제거.
- 정상 cleanup에서 업로드한 3개 이미지 모두 목록 부재 및 content URL 404/410 확인. 종료 후 별도 로그인/전체 계층·이미지 목록 재조회에서 QA Site/HC/HS/이미지 잔여 0개 확인. 기존 Site 1개, HC 3개, HS 6개 유지.
- Monitoring에서 QA Site 선택 및 모니터링 이미지 미설정 안내 확인. 대표 이미지 Canvas 반영은 Spatial 전제 데이터가 없으므로 범위 밖이며 편집 화면 저장·재진입에서 대표 상태를 검증했습니다.
- 이미지 content 조회 차단은 검증했으나 원격 저장소 물리 객체 잔여 여부는 직접 조회하지 않았습니다. 강제 종료/외부 저장소·SDK 장애 시 수동 복구가 필요할 수 있습니다.

## Participant 등록/로그인 QA (local 전용)

- `tests/participant.spec.ts`에 관리자 등록 → 자동 participantNo 확인 → 참가자 로그인/로그아웃 → 관리자 삭제 흐름, 중복 loginId 거부, 이름 필수값 Validation의 3개 회귀 테스트를 추가했습니다. 실행 명령은 기존 `npm run test:crud`이며 새 스크립트는 없습니다.
- 매 테스트에 UUID 기반 `[QA] Participant …` 이름과 `qa-participant-…` loginId를 사용합니다. participantNo는 입력하지 않고 상세 화면에서 서비스가 발급한 숫자를 검사합니다. 현재 실행 환경에 접속할 수 없어 목록의 participantNo 열 구조를 확인하지 못했으므로 번호 최대값 비교는 추가하지 않았습니다.
- 최초 목록의 참가자 상세 링크와 행 텍스트를 보관합니다. cleanup은 이번 실행의 정확한 고유 이름으로만 참가자를 찾고 기존 ID와 다름을 확인한 뒤 상세 화면의 삭제 UI를 사용합니다. 삭제 후 새 목록 GET에서 부재와 기존 11개 행의 유지를 확인합니다. 다른 QA 참가자를 일괄 정리하지 않습니다.
- 생성 POST 직전에 cleanup 상태를 설정해 응답 유실도 정리 대상으로 삼습니다. fixture teardown에서 별도 페이지로 관리자 재로그인 후 삭제를 재시도합니다. cleanup 오류는 첨부/로그에 남기고 최초 시나리오 실패를 보존합니다. 강제 종료나 서버 장애로 정리가 안 되면 `qa-participant` annotation의 정확한 이름/loginId를 대조해 수동으로 정리합니다.
- `site-crud.spec.ts`와 동일하게 localhost / 127.0.0.1 / [::1] HTTP(S)만 허용하고 외부 mutation/navigation은 route에서 차단합니다. Production 설정은 기존 read-only project만 선택하므로 Participant 테스트를 실행하지 않습니다. Local URL guard는 연결된 DB 종류까지 확인하지 않으므로 localhost가 테스트 DB를 사용하는지 확인해야 합니다.
