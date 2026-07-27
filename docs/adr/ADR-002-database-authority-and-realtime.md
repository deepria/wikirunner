# ADR-002: DB 권위 상태와 Realtime projection

- 상태: 승인
- 날짜: 2026-07-27

## 배경

Realtime 메시지는 빠르지만 누락·중복·재정렬될 수 있고, 연결이 끊긴 클라이언트가 전체
상태를 복구할 수 있어야 한다.

## 결정

- PostgreSQL을 방·경기·run·순위 상태의 단일 진실의 원천으로 사용한다.
- 여러 테이블을 바꾸는 명령은 Edge Function에서 권한을 확인한 뒤 단일 RPC 트랜잭션으로
  실행한다.
- Realtime에는 참가자에게 허용된 projection만 발행한다.
- 구독 직후, 재연결 후, version 또는 sequence 누락 시 DB snapshot을 다시 조회한다.
- 클라이언트의 테이블 직접 쓰기는 RLS로 거부한다.

## 결과

복구와 동시성 규칙이 명확해진다. Realtime 화면은 반드시 snapshot fallback과 resource
version 비교를 구현해야 한다.

