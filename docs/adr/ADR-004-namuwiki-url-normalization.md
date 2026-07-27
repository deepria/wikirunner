# ADR-004: 나무위키 URL 정규화

- 상태: 승인
- 날짜: 2026-07-27

## 배경

나무위키의 URL과 DOM은 외부 계약이며 변경될 수 있다. 링크 판정이 웹·확장·서버에 흩어지면
서로 다른 문서 키를 만들 위험이 있다.

## 결정

- URL 정규화는 `packages/namuwiki`의 순수 함수로 구현하고 공통 테스트 벡터를 사용한다.
- canonical URL을 우선하고 현재 URL을 fallback으로 사용한다.
- HTTPS, 정확한 허용 host, `/w/{article}` 경로만 허용한다.
- query와 fragment를 제외하고 percent-decoding 후 Unicode NFC를 적용한다.
- 파일·분류 namespace와 편집·토론·역사 같은 비문서 경로를 거부한다.
- 문서 표시 제목과 비교용 `article_key`를 분리한다.

## 결과

외부 변경의 영향 범위가 adapter와 테스트로 제한된다. 허용 host와 namespace 변경은 계약
버전 및 fixture 검증과 함께 배포해야 한다.

