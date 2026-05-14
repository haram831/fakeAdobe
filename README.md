# Unanchor

Fourier Curve 기반 드로잉 툴 프로토타입입니다.

## 목표

Adobe식 베지어 곡선 편집 방식 대신, 주파수와 위상, 진폭, 시간으로 곡선을 생성하고 조작하는 실험적 드로잉 도구를 만듭니다.

## 개발

```bash
npm install
npm run dev
```

## 기본 구조

```text
src/
  components/   UI와 캔버스 컴포넌트
  hooks/        포인터 입력, 애니메이션 등 React 훅
  lib/          Fourier 계산, 샘플링, export 로직
  styles/       전역 스타일
```
