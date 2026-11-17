# devlog — 개발 블로그

devlog는 배운 점과 겪은 버그를 기록하는 기술 블로그입니다. 화면은 빌드 도구 없이 HTML·CSS·JavaScript만으로 만들어 GitHub Pages로 배포하고, 글과 계정은 [Supabase](https://supabase.com)(PostgreSQL + Auth)에 저장합니다.

매일 오전 9시(KST)에는 GitHub Actions가 GitHub Trending 상위 저장소 2개를 골라 README 기반 한국어 리뷰를 자동으로 게시합니다.

## 주요 기능

- **누구나 읽기, 로그인하면 쓰기**: 글 목록과 본문은 로그인 없이 볼 수 있고, 글 작성·수정은 로그인한 사용자가 자기 글에만 할 수 있습니다. 이 권한은 DB가 직접 강제합니다.
- **계정**: 이메일·비밀번호로 가입하고, 화면에는 사용자 이름이 표시됩니다(Supabase Auth).
- **Markdown-ish 렌더링**: 제목(`#`), 목록, 인용(`>`), 코드 블록(```` ``` ````), 굵게, 인라인 코드, https 링크를 지원합니다. 모든 입력은 이스케이프한 뒤 변환합니다.
- **Today / 지난글 목록**: 최신순으로 정렬하고 오늘 올라온 글에 NEW 배지를 붙입니다.
- **라이트/다크 테마**: 시스템 설정을 따르고, 선택한 테마는 브라우저에 기억됩니다.
- **GitHub Trending 자동 게시**: 일간 Trending 후보를 누적 Star(또는 오늘 증가 Star) 순으로 골라 하루 2편을 함께 게시합니다. 자세한 설정은 [AUTOMATION.md](AUTOMATION.md)를 참조하세요.
- **이전 글 가져오기**: DB 전환 전에 브라우저(localStorage)에만 저장했던 글은 로그인 후 홈 화면의 안내에서 내 계정으로 한 번에 옮길 수 있습니다.

## 페이지 구성

| 페이지 | 역할 | 로그인 필요 |
| --- | --- | --- |
| `index.html` | 홈. Today/지난글 목록과 글 수 통계 | 아니요 |
| `dynamic-post.html?id=…` | 글 상세 보기 | 아니요 |
| `create-post.html` | 새 글 작성 | 예 |
| `edit-post.html?id=…` | 본인 글 수정 | 예 |
| `import-post.html` | 자동 게시 현황과 설정 안내 | 아니요 |
| `login.html` / `signup.html` | 로그인 / 회원가입 | 아니요 |
| `post1.html` | 정적 예시 글 | 아니요 |

## 구성

```text
외부 API (GitHub Trending · OpenAI)
        │
GitHub Actions (매일 09:00 KST, scripts/trending_posts.py)
        │  상위 2개 요약 · 링크/HTML 제거
        ├──▶ data/trending-posts.json (커밋, 자동 게시 현황 페이지용)
        └──▶ Supabase posts 테이블 (service_role 키, 서버에서만)
                       ▲
                       │ anon 키 + 로그인 세션 (RLS가 행 단위로 권한 검사)
GitHub Pages ──▶ 브라우저(app.js): 조회 · 작성 · 수정 · 렌더링
```

```text
*.html                       페이지
app.js                       인증·렌더링·글 작성/수정 (Supabase 호출)
supabase-config.js           Supabase 프로젝트 URL과 anon 키
vendor/supabase-2.45.4.min.js  Supabase JS SDK (버전 고정, 로컬 제공)
supabase/schema.sql          테이블·RLS 정책·트리거
theme-init.js                테마 초기화(CSP 대응)
published-posts.js, import-post.js  자동 게시 현황 페이지
style.css                    라이트/다크 테마 스타일
scripts/trending_posts.py    자동 게시 스크립트(표준 라이브러리만 사용)
data/trending-posts.json     자동 게시 결과
.github/workflows/           매일 실행·Pages 배포
tests/                       Node · Python 테스트
```

## Supabase 설정

1. [supabase.com](https://supabase.com)에서 프로젝트를 만듭니다.
2. **SQL Editor**에 [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여 넣고 실행합니다. 여러 번 실행해도 안전합니다.
3. **Project Settings → API**에서 Project URL과 `anon`(public) 키를 복사해 `supabase-config.js`에 넣습니다. anon 키는 공개되어도 되는 키이며 데이터 보호는 RLS 정책이 맡습니다. **service_role 키는 이 파일에 절대 넣지 마세요.**
4. **Authentication → URL Configuration**의 Site URL과 Redirect URLs에 블로그 주소를 등록합니다. 예: `https://<사용자>.github.io/myTechBlog/`, 로컬 개발용 `http://127.0.0.1:8000/`. 가입 확인 메일의 링크가 이 주소로 돌아옵니다.
5. **Authentication → Providers → Email**에서 최소 비밀번호 길이를 8자로 맞추는 것을 권장합니다. 화면에서도 8자 이상을 검사합니다.
6. 자동 게시 글도 DB에 넣으려면 GitHub 저장소에 Actions Variable `SUPABASE_URL`과 Secret `SUPABASE_SERVICE_ROLE_KEY`를 등록합니다. 이미 게시된 글은 `python scripts/trending_posts.py --sync-db`로 한 번에 옮길 수 있습니다.

## 로컬 실행과 테스트

Python 3.11 이상과 Node.js 18 이상이면 추가 패키지 없이 실행됩니다. `file://`로 열면 동작하지 않으므로 HTTP 서버로 엽니다.

```powershell
python -m http.server 8000 --bind 127.0.0.1
# 브라우저에서 http://127.0.0.1:8000/ 접속
```

```powershell
python -m unittest discover -s tests -p "test_*.py"
node --test tests/*.cjs
```

`supabase-config.js`를 채우지 않으면 페이지 상단에 설정 안내가 표시됩니다.

## 보안 설계와 한계

| 항목 | 적용 내용 |
| --- | --- |
| 인증 | Supabase Auth(서버 측). 비밀번호 해시·세션 토큰 발급과 갱신을 Supabase가 처리 |
| 권한 | PostgreSQL RLS: 읽기는 전체 공개, 작성·수정·삭제는 본인 글만, 자동 게시 글은 service_role만 작성 |
| 서버 고정 값 | 작성자(`author_id`)는 DB 기본값 `auth.uid()`로 정하고, 트리거가 수정 시 작성자·출처·작성 시각 변경을 막음 |
| 컬럼 권한 | 클라이언트는 제목·본문·표시 이름(가져오기 시 작성 시각)만 쓸 수 있음 |
| 입력 검증 | 화면과 DB 양쪽에서 길이·형식 검사(사용자 이름 3~30자, 비밀번호 8자 이상, 제목 200자, 본문 10만 자) |
| XSS 방어 | 본문은 이스케이프 후 렌더링, 링크는 `https?://`만 허용하고 `rel="noopener noreferrer"` 적용 |
| CSP | `script-src 'self'`(SDK도 로컬 제공), `connect-src`는 자기 자신과 `*.supabase.co`만 허용 |
| AI 생성 본문 | 링크·URL·HTML·코드 펜스·제목 기호를 제거한 뒤 게시(README 프롬프트 인젝션 대비) |
| 비밀 정보 | `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 Actions Secret에만 보관 |

> Supabase 커스텀 도메인을 쓰면 각 HTML의 CSP `connect-src`에 그 도메인을 추가해야 합니다.
> DB 전환 전 브라우저에만 있던 계정은 옮겨지지 않으므로 새로 가입해야 합니다. 글은 가져오기 기능으로 옮길 수 있습니다.
