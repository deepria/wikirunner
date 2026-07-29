import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "개인정보처리방침 | WikiRunner",
  description: "WikiRunner 개인정보처리방침",
};

const effectiveDate = "2026년 7월 29일";

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <nav aria-label="주요 메뉴">
        <a className="brand" href="/">
          WikiRunner
        </a>
        <a className="privacy-home-link" href="/">
          홈으로 돌아가기
        </a>
      </nav>

      <article className="privacy-content">
        <header className="privacy-heading">
          <p className="eyebrow">PRIVACY POLICY</p>
          <h1>개인정보처리방침</h1>
          <p>시행일: {effectiveDate}</p>
        </header>

        <p>
          WikiRunner(이하 “서비스”)는 친구와 함께 나무위키 내부 링크 스피드런 게임을
          진행할 수 있도록 웹 서비스와 Chrome 확장 프로그램을 제공합니다. 이 방침은
          서비스가 처리하는 정보와 그 목적을 설명합니다.
        </p>

        <section>
          <h2>1. 처리하는 정보</h2>
          <ul>
            <li>
              <strong>사용자 입력 정보:</strong> 닉네임, 방 코드
            </li>
            <li>
              <strong>인증 정보:</strong> 익명 인증을 위한 사용자 식별자와 세션 토큰
            </li>
            <li>
              <strong>경기 정보:</strong> 방·참가자·경기 상태, 시작·목표 문서, 완주 시간,
              이동 횟수, 순위
            </li>
            <li>
              <strong>경기 중 이동 기록:</strong> 경기용 나무위키 탭에서의 이전·도착 문서,
              이동 시각, 이동 유형 및 규칙 위반 경고
            </li>
            <li>
              <strong>기기 내 저장 정보:</strong> 연결 상태, 현재 경기 상태 및 네트워크
              오류 시 재전송을 위한 임시 이동 기록
            </li>
          </ul>
          <p>
            확장 프로그램은 경기 목적 외의 웹 탐색 기록을 저장하거나 전송하지 않으며,
            검색어·페이지 전체 내용·비밀번호·쿠키를 수집하지 않습니다.
          </p>
        </section>

        <section>
          <h2>2. 정보의 이용 목적</h2>
          <ul>
            <li>방 생성·참가, 참가자 식별 및 확장 프로그램 페어링</li>
            <li>동시 시작, 경기 진행, 이동 검증, 기록·순위 표시</li>
            <li>검색·랜덤 문서·새 탭 우회와 같은 경기 규칙 위반 경고 기록</li>
            <li>일시적인 네트워크 오류 뒤 경기 기록을 재전송하고 서비스 오류를 해결</li>
          </ul>
        </section>

        <section>
          <h2>3. Chrome 확장 프로그램 권한</h2>
          <p>
            확장 프로그램은 위 목적을 위해 나무위키 문서 페이지에서만 동작하며, 경기 중
            문서 이동을 확인하고 상태 오버레이를 표시합니다. 경기 시작 시 전용 탭을 열고,
            검색·랜덤 문서 페이지 이동을 경기 탭에서만 차단할 수 있습니다. 알람과 로컬
            저장소는 경기 시작 예약 및 미전송 기록의 재전송에 사용합니다.
          </p>
        </section>

        <section>
          <h2>4. 제3자 제공 및 처리 위탁</h2>
          <p>
            서비스는 사용자 정보를 판매하거나 광고·신용 평가 목적으로 사용하지 않습니다.
            게임 데이터와 익명 인증을 처리하기 위해 Supabase를 서비스 인프라 제공자로
            사용합니다. Supabase는 WikiRunner 서비스 운영을 위해 필요한 범위에서만 정보를
            처리합니다.
          </p>
          <p>
            같은 방의 참가자는 경기 진행에 필요한 닉네임, 준비·연결 상태, 완주 시간,
            이동 횟수와 순위를 볼 수 있습니다. 경기 종료 또는 취소 뒤에는 해당 방의
            참가자가 경기 경로와 규칙 위반 경고를 확인할 수 있습니다.
          </p>
        </section>

        <section>
          <h2>5. 보관 및 삭제</h2>
          <p>
            정보는 서비스 운영과 경기 기록 제공에 필요한 기간 동안 보관합니다. 연결 해제
            또는 경기 종료 시 확장 프로그램의 현재 경기 상태와 재전송 대기 기록은 기기에서
            삭제됩니다. 사용자는 아래 문의처를 통해 본인 데이터의 열람·정정·삭제를 요청할
            수 있습니다.
          </p>
        </section>

        <section>
          <h2>6. 안전한 처리</h2>
          <p>
            서비스와 서버 간 통신은 HTTPS를 사용합니다. 인증 세션과 경기 상태는 서비스
            제공에 필요한 범위에서만 사용하며, 서비스 역할 키나 사용자의 비밀번호는
            확장 프로그램에 저장하지 않습니다.
          </p>
        </section>

        <section>
          <h2>7. 문의 및 방침 변경</h2>
          <p>
            개인정보 관련 문의 또는 삭제 요청은 <strong>diajint_823@naver.com</strong>로
            보내 주세요. 방침이 변경되면 이 페이지의 시행일을 갱신해 알립니다.
          </p>
          <p className="privacy-note">
            WikiRunner는 나무위키와 제휴하거나 공식 지원을 받는 서비스가 아닙니다.
          </p>
        </section>
      </article>
    </main>
  );
}
