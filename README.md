# Wave Survival FPS

순수 HTML/CSS/JavaScript로 구현한 1인칭 슈팅 서바이벌 게임. 외부 라이브러리 없이 Canvas 2D 레이캐스팅(Wolfenstein 3D 스타일)으로 의사 3D 렌더링을 수행한다.

## 실행 방법

브라우저는 `file://`에서도 동작하지만 일부 기능(Pointer Lock, 오디오 샘플 fetch 등) 호환성을 위해 로컬 서버 권장.

```bash
python3 -m http.server 8080
# 브라우저에서 http://localhost:8080 열기
```

### 데스크탑 설치 파일 (Electron)

Windows `.exe` / macOS `.dmg` / Linux `AppImage` 설치 파일로도 빌드할 수 있다.
자세한 방법은 [`docs/DESKTOP_BUILD.md`](docs/DESKTOP_BUILD.md) 참고.

```bash
npm install
npm start        # 개발 모드 실행
npm run dist     # 현재 OS용 설치 파일 생성 → dist/
```

## 조작법

### 데스크탑

| 키 | 동작 |
|----|----|
| W A S D | 전후좌우 이동 |
| 마우스 | 시점 회전 (Pointer Lock) |
| 좌클릭 | 사격 (홀드로 자동 사격) |
| R | 재장전 |
| Shift | 달리기 (스태미나 소모) |
| 1 ~ 4 | 무기 교체 |
| ESC | 일시정지 |

### 모바일 / 터치

가상 조이스틱 + 사격/재장전/무기교체/일시정지 버튼, 화면 우측 드래그로 시점 회전.

## 핵심 기능

- **레이캐스팅 엔진**: DDA 알고리즘으로 벽 거리 측정, per-column zBuffer + see-over wall 클리핑으로 키 큰 적이 낮은 엄폐물 위로 머리만 보이게 처리
- **per-pixel 바닥 캐스팅**: 콘크리트 텍스처를 월드 좌표 기준으로 샘플링해 카메라 회전에 맞춰 같이 회전 (2×2 블록 + `createImageData` 재사용으로 readback 비용 제거)
- **무기 4종**: 권총 / 샷건 / 기관총 / 저격총 — 각자 데미지·연사·퍼짐·관통·예약 탄약·재장전 시간 특성
- **적 8종**: 졸개 / 돌진형 / 탱커 / 원거리 / 자폭형 / 분열형 / 분열체 / 보스 (5웨이브마다)
- **로그라이크 업그레이드**: 웨이브 클리어마다 3개 중 1개 선택 (공격/방어/유틸 + 무기 해금)
- **콤보 시스템**: 2초 이내 연속 킬 ×1.5 → ×2 → ×3, 헤드샷 ×2 추가
- **데일리 챌린지**: `YYYYMMDD` 시드로 적 구성·스폰·업그레이드 카드가 모두 결정 — 같은 날엔 같은 런
- **기록 시스템**: 닉네임 + 최고 wave/score/kills/combo 영속 저장, 게임오버 시 직전 기록 대비 +Δ 또는 "−N 부족" 표시
- **픽업 5종**: 적 처치 시 확률적으로 드롭, 보스 처치 시 다중 픽업 폭사
- **사운드**: Web Audio API 합성 + 외부 오디오 샘플 (사격 / 피격 / 재장전 / 발소리)
- **HUD**: 체력/스태미나 바, 미니맵, 무기·탄약, 콤보, 웨이브 배너, 신기록 배너, 피격 비네트, 보스 enrage 플래시

## 파일 구조

```
index.html              메인 페이지, 캔버스 + HUD DOM
style.css               HUD/오버레이 스타일
assets/                 적 스프라이트(PNG) + 1인칭 총기 이미지
assets/audio/           사격 / 피격 / 재장전 / 발소리 샘플
js/main.js              게임 루프, 입력, 상태 머신, 웨이브 매니저, 기록 영속화
js/raycaster.js         DDA 레이캐스팅 + 스프라이트 빌보드 + 바닥/하늘 패스
js/map.js               42×42 아레나 데이터, 충돌, 시야선, 8종 벽 타일 정의
js/walltextures.js      8종 벽 타일의 절차적 텍스처 생성
js/player.js            이동, 사격, 재장전, 콤보, 업그레이드 모디파이어, 파티클 스폰
js/weapon.js            4종 무기 정의
js/enemy.js             8종 적 AI, 스폰, 웨이브 구성, 보스 소환·enrage
js/pickups.js           아이템 드롭 / 픽업 처리
js/environment.js       웨이브별 분위기 테마 (sunset / dusk / night / storm)
js/audio.js             Web Audio API 효과음 + 샘플 재생
js/ui.js                HUD 갱신, 미니맵, 메뉴, 업그레이드 카드, 1인칭 무기 그리기
js/mobile.js            모바일 가상 조이스틱 + 버튼
js/sprite.js            PNG 스프라이트 로더 + 키잉
js/random.js            데일리 챌린지용 시드 RNG (mulberry32)
```
