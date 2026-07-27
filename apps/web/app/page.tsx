import { ROOM_STATUSES } from "@wikirunner/contracts";

export default function Home() {
  return (
    <main>
      <nav aria-label="주요 메뉴">
        <a className="brand" href="/">
          WikiRunner
        </a>
        <span className="status">MVP · {ROOM_STATUSES[0]}</span>
      </nav>

      <section className="hero">
        <p className="eyebrow">WIKI LINK SPEEDRUN</p>
        <h1>
          검색 없이,
          <br />
          링크만 따라 달리세요.
        </h1>
        <p className="summary">
          같은 문서에서 출발해 나무위키 내부 링크만으로 목표 문서에 먼저 도착하는 실시간
          스피드런입니다.
        </p>

        <div className="actions">
          <a className="primary" href="/rooms/new">
            새 방 만들기
          </a>
          <a className="secondary" href="/rooms/join">
            방 코드로 입장
          </a>
        </div>
      </section>

      <section className="rule-card" aria-labelledby="rules-title">
        <div>
          <p className="eyebrow">HOW TO RUN</p>
          <h2 id="rules-title">딱 세 가지만 기억하세요.</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            모두 같은 문서에서 출발합니다.
          </li>
          <li>
            <span>02</span>
            본문 안의 내부 링크로만 이동합니다.
          </li>
          <li>
            <span>03</span>
            목표 도착 시간과 이동 횟수로 순위를 정합니다.
          </li>
        </ol>
      </section>
    </main>
  );
}
