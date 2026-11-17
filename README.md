# devlog — 개발 블로그

devlog는 배운 점과 겪은 버그를 기록하는 정적 기술 블로그입니다. 빌드 도구나 서버 없이 HTML·CSS·JavaScript만으로 동작하며 GitHub Pages로 배포됩니다.

직접 쓴 글은 브라우저 localStorage에 저장됩니다. 매일 오전 9시(KST)에는 GitHub Actions가 GitHub Trending 상위 저장소 2개를 골라 README 기반 한국어 리뷰를 자동으로 게시합니다.

## 주요 기능

- **글 작성·수정**: 제목·작성자·본문을 입력하면 작성 시각과 함께 저장되고, 수정하면 '수정됨' 표시가 붙습니다.
- **Markdown-ish 렌더링**: 제목(`#`), 목록, 인용(`>`), 코드 블록(```` ``` ````), 굵게, 인라인 코드, https 링크를 지원합니다. 모든 입력은 이스케이프한 뒤 변환합니다.
- **Today / 지난글 목록**: 최신순으로 정렬하고 오늘 올라온 글에 NEW 배지를 붙입니다.
- **라이트/다크 테마**: 시스템 설정을 따르고, 선택한 테마는 브라우저에 기억됩니다.
- **GitHub Trending 자동 게시**: 일간 Trending 후보를 누적 Star(또는 오늘 증가 Star) 순으로 골라 하루 2편을 함께 게시합니다. 같은 날 재실행해도 중복 게시하지 않습니다. 자세한 설정은 [AUTOMATION.md](AUTOMATION.md)를 참조하세요.
- **로그인·회원가입**: 브라우저 안에서만 동작하는 간이 인증입니다.

## 페이지 구성

| 페이지 | 역할 | 로그인 필요 |
| --- | --- | --- |
| `index.html` | 홈. Today/지난글 목록과 글 수 통계 | 예 |
| `dynamic-post.html?id=…` | 글 상세 보기 | 예 |
| `create-post.html` | 새 글 작성 | 예 |
| `edit-post.html?id=…` | 글 수정(자동 글은 이 브라우저에만 저장) | 예 |
| `import-post.html` | 자동 게시 현황과 설정 안내 | 아니요 |
| `login.html` / `signup.html` | 로그인 / 회원가입 | 아니요 |
| `post1.html` | 정적 예시 글 | 예 |

## 구성

```text
외부 API (GitHub Trending · OpenAI)
        │
GitHub Actions (매일 09:00 KST, scripts/trending_posts.py)
        │  상위 2개 요약 · 링크/HTML 제거
        ▼
data/trending-posts.json ──커밋·배포──▶ GitHub Pages
                                              │ fetch
localStorage (직접 쓴 글·계정·테마) ──▶ 브라우저(app.js): 병합 · 이스케이프 · 렌더링
```

자동 글과 직접 쓴 글은 따로 저장되고 브라우저에서만 합쳐집니다. 같은 ID라면 로컬 수정본이 우선합니다.

```text
*.html                     페이지
app.js                     인증·렌더링·글 작성/수정
published-posts.js         자동 글 JSON 로드·검증·캐시
theme-init.js              테마 초기화(CSP 대응)
import-post.js             자동 게시 현황 페이지
style.css                  라이트/다크 테마 스타일
scripts/trending_posts.py  자동 게시 스크립트(표준 라이브러리만 사용)
data/trending-posts.json   자동 게시 결과
.github/workflows/         매일 실행·Pages 배포
tests/                     Node · Python 테스트
```

## 로컬 실행과 테스트

Python 3.11 이상과 Node.js 18 이상이면 추가 패키지 없이 실행됩니다. `file://`로 열면 JSON을 불러오지 못하므로 HTTP 서버로 엽니다.

```powershell
python -m http.server 8000 --bind 127.0.0.1
# 브라우저에서 http://127.0.0.1:8000/ 접속 → 회원가입 후 사용
```

```powershell
python -m unittest discover -s tests -p "test_*.py"
node --test tests/*.cjs
```

자동 게시를 로컬에서 돌리려면 `OPENAI_API_KEY`를 설정한 뒤 `python scripts/trending_posts.py`를 실행합니다. `--inspect`는 후보 수집만 하고 API를 호출하지 않습니다.

## 보안 설계와 한계

| 항목 | 적용 내용 |
| --- | --- |
| 비밀번호 저장 | 사용자별 salt + PBKDF2-SHA256 210,000회(Web Crypto). 이전 방식 계정은 로그인 시 자동 전환 |
| 세션 토큰 | 256비트 난수, 사용자에 묶어 검증하고 로그아웃 시 폐기 |
| 인증 실패 | 즉시 렌더링을 중단하고 로그인 페이지로 이동 |
| 가입 입력 검증 | 사용자 이름 3~30자(영문·숫자·`_ . -`), 비밀번호 8자 이상 |
| XSS 방어 | 본문은 이스케이프 후 렌더링, 링크는 `https?://`만 허용하고 `rel="noopener noreferrer"` 적용 |
| CSP | `script-src 'self'` 등 CSP 메타 태그. 인라인 스크립트 없음 |
| AI 생성 본문 | 링크·URL·HTML·코드 펜스·제목 기호를 제거한 뒤 게시(README 프롬프트 인젝션 대비) |
| 비밀 정보 | `OPENAI_API_KEY`는 Actions Secret에만 보관하며 브라우저에 입력하지 않음 |

손상된 localStorage 데이터가 있어도 페이지가 멈추지 않도록 안전하게 읽습니다.

> 서버가 없는 정적 사이트이므로 로그인은 같은 브라우저 안에서만 의미가 있습니다. 글을 여러 사람이 공유하거나 실제 권한을 나눠야 한다면 서버 측 인증이 필요합니다.
