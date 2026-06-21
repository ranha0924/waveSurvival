# 데스크탑 설치 파일 빌드 (Electron)

이 게임을 Windows `.exe`(또는 macOS `.dmg`, Linux `AppImage`) **설치 파일**로
패키징하는 방법입니다. 게임 본체는 순수 정적 사이트라, Electron이 내장된 초경량
정적 서버로 `http://127.0.0.1`에 띄운 뒤 그 화면을 그대로 보여줍니다.

> **협동 모드**는 기존 Render 릴레이 서버(`wss://wavesurvival-relay.onrender.com`)에
> 그대로 연결됩니다. 설치 파일에는 게임 클라이언트만 들어가고, 협동을 하려면
> 인터넷 연결이 필요합니다.

## 사전 준비

- [Node.js](https://nodejs.org/) 18 이상 설치

## 개발 모드로 실행 (빌드 없이 바로 확인)

```bash
npm install
npm start
```

Electron 창이 뜨고 게임이 실행됩니다.

## 설치 파일 만들기

```bash
npm install

# 현재 OS용 설치 파일
npm run dist

# 또는 특정 OS 지정
npm run dist:win     # Windows  → dist/Wave Survival Setup x.y.z.exe
npm run dist:mac     # macOS    → dist/Wave Survival-x.y.z.dmg
npm run dist:linux   # Linux    → dist/Wave Survival-x.y.z.AppImage
```

완성된 설치 파일은 `dist/` 폴더에 생성됩니다.

> **참고:** Windows용 `.exe`는 Windows에서, macOS용 `.dmg`는 macOS에서 빌드하는
> 것이 가장 안정적입니다. (크로스 빌드도 가능하지만 코드 서명 등 추가 설정이
> 필요할 수 있습니다.)

## 앱 아이콘

브라우저 파비콘과 동일한 디자인(붉은 부적 + 금색 符)을 그대로 앱 아이콘으로
씁니다. `assets/icon.png`(512×512)가 그 아이콘이며, electron-builder가 빌드 시
각 OS 포맷(Windows `.ico` / macOS `.icns`)으로 자동 변환합니다.

원본은 `assets/icon.svg`이고, 수정 후 PNG를 다시 만들려면 SVG를 512×512 PNG로
래스터화해 `assets/icon.png`를 덮어쓰면 됩니다 (CJK 글리프 포함 폰트 필요).

다른 아이콘으로 바꾸려면 `package.json`의 `build.win.icon` /
`build.mac.icon` / `build.linux.icon` 경로를 교체하세요.
