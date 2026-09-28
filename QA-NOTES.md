# 관리자 조회 QA (1단계)

IntelliJ에서 manage를 실행한 후 QA 프로젝트에서 실행합니다.

```sh
npx playwright test
npx tsc --noEmit
npx playwright test tests/healing-spot.spec.ts tests/map.spec.ts --headed
```

- 기존 smoke/login/monitoring 3개 + HS 상세/Gallery 2개 + 지도 1개 + navigation 5개 = 11개.
- `loginAsAdmin`을 그대로 재사용합니다. 서버 시작/종료나 데이터 CRUD는 수행하지 않습니다.
- 기본 선택 Site에 모니터링 이미지와 배치된 HS가 있어야 합니다. 목록 조회 경로에는 기존 Site/HC/HS가 필요합니다.
- HS는 실제 Canvas의 `상세 보기` 버튼 중 하나를 선택합니다. DB ID나 HS 코드는 고정하지 않습니다.
- 상세 GET 응답 후 Gallery 상태 메시지가 비워질 때까지 기다립니다. 이미지 URL뿐 아니라 visible/complete/naturalWidth도 검증합니다.
- 이미지 0개는 등록 이미지 없음 상태, 1개는 단일 이미지와 숨겨진 Thumbnail 영역을 검증합니다. 2개 이상이면 선택되지 않은 Thumbnail을 클릭해 큰 이미지 URL과 로딩 완료를 확인합니다.
- 이미지/API 오류를 정상 이미지 없음으로 취급하지 않습니다. 오류가 발생하면 테스트는 실패하며 기존 trace/screenshot 설정으로 진단합니다. 이미지 0/1개 및 오류 상태를 위한 별도 데이터 생성이나 응답 mock은 하지 않습니다.
- Navigation: 관리자 메인에서 사이트/참가자/일정/달력 메뉴, Site → HC → HS 목록/상세 링크를 클릭해 HTTP 200, URL, 제목을 확인합니다. 달력 내부 SDK 렌더링은 이 smoke 범위 밖입니다.

## 지도 Marker 범위

2026-09-28 실제 headless DOM을 확인했습니다. Marker는 이름/제목이 없는 `role="presentation"` 이미지와 SDK가 만든 `daum.maps.Marker.Area:N`의 `map/area` 조합입니다. 앱 소유의 안정적인 식별자가 없으므로 이미지 URL, 생성 ID, 픽셀 좌표에 의존하는 클릭은 고정 테스트에 넣지 않았습니다. 지도 dialog와 `#map` 표시 및 닫기/포커스 복귀만 검증합니다. 지도 타일/Marker 로딩 성공을 보장하는 테스트는 아닙니다.

headed 수동 점검: 지도 Marker 클릭 → 해당 HS 상세 Modal, Gallery 이미지 전환, 이미지 없음/오류 안내.
CRUD QA 전에는 전용 테스트 데이터와 정리/복구 기준을 먼저 정해야 합니다.
