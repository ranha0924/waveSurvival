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

## 아이콘 교체

기본값은 `assets/boss.png`를 앱 아이콘으로 씁니다. 전용 아이콘을 쓰려면
`package.json`의 `build.win.icon` / `build.mac.icon` 경로를 바꾸세요.
- Windows: `.ico` (256×256 권장)
- macOS: `.icns`
- Linux: `.png` (512×512 권장)
