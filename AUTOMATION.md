# GitHub Trending 자동 게시

일간 Trending 후보의 누적 Star를 GitHub REST API로 확인하고 내림차순 상위 2개를 선정합니다.
README와 설명을 OpenAI Responses API로 한국어 요약해 `data/trending-posts.json`에 두 글을 함께 게시합니다.
설치·실행 테스트가 아닌 문서 기반 AI 리뷰임을 본문에 표시합니다.

## 시작하기

1. 이 변경을 GitHub 저장소 기본 브랜치에 반영합니다.
2. Settings → Secrets and variables → Actions → Secrets에 `OPENAI_API_KEY`를 등록합니다.
3. Settings → Pages → Source를 **GitHub Actions**로 선택합니다.
4. Actions → **Daily Trending Posts** → **Run workflow**를 실행합니다.
5. 성공 시 JSON 커밋과 Pages 배포가 완료됩니다. `import-post.html`에서 결과를 확인합니다.

기본 일정은 UTC 00:00 = 한국 시간 매일 오전 9시입니다. Actions 지연, 비활성화, 기본 브랜치 권한,
환경 승인, API 쿼터 등으로 실패할 수 있으므로 Actions 실행 기록을 확인하세요.
공개 저장소에서 장기간 활동이 없으면 예약 실행이 비활성화될 수 있습니다.
브랜치 보호가 봇의 직접 커밋을 차단하면 저장소 정책에 맞는 게시 브랜치/권한 설정이 필요합니다.
이 코드 변경만으로 원격 워크플로가 활성화되는 것은 아닙니다.

Actions Variables:
- `OPENAI_MODEL`: 기본 `gpt-4.1-mini`. 구조화 응답을 지원하는 접근 가능한 모델을 지정하세요.
- `TRENDING_SORT`: `total`(누적 Star, 기본) 또는 `daily`(오늘 증가 Star).

API 호출 비용이 발생합니다. 키는 Secret/실행 환경에만 두고 커밋하거나 브라우저에 입력하지 마세요.
README는 최대 24,000자만 요약 입력으로 사용합니다. 긴 문서 전체나 실제 코드를 검토한 결과가 아닙니다.

## 로컬 실행

Python 3.11 이상, 추가 패키지 불필요. 실행 환경에 OPENAI_API_KEY를 설정한 뒤:

```powershell
python scripts/trending_posts.py --inspect
python scripts/trending_posts.py
python -m http.server 8000 --bind 127.0.0.1
```

`--inspect`는 후보 수집만 수행하며 요약 API를 호출하거나 게시하지 않습니다.
`GITHUB_TOKEN`은 선택 사항이며 비인증 GitHub API 제한에 걸릴 때 설정합니다.
`--sort daily`로 증가 Star를 기준으로 실행할 수 있습니다.
http://127.0.0.1:8000/import-post.html 에서 게시 내역을 확인합니다.
파일 더블클릭(file://)은 JSON fetch를 지원하지 않으므로 HTTP로 실행하세요.
PC에서 매일 실행하려면 운영체제 예약 작업에 같은 명령을 등록하고 PC를 켜 두어야 합니다.
GitHub Actions 방식은 PC나 브라우저가 꺼져 있어도 실행됩니다.

## 데이터와 재실행

- 날짜와 일일 중복 방지는 한국 시간 기준입니다. 같은 날 성공 후 재실행은 API 호출 없이 종료합니다.
- 다음 날 같은 저장소가 다시 상위 2개이면 그날의 새 리뷰로 작성합니다.
- 두 글 중 하나라도 요약/검증에 실패하면 기존 게시 파일을 유지하고 오류 종료합니다.
- 로컬 lock 파일과 Actions concurrency로 동시 게시를 막습니다.
- 프로세스를 강제 종료한 경우 실행 중인 작업이 없는지 확인한 후 남은 `data/trending-posts.lock`을 제거합니다.
- README를 읽지 못하거나 Trending 구조가 바뀐 경우 순위가 낮은 다른 저장소로 몰래 대체하지 않습니다.
- 공용 자동 글은 서버 JSON에서 읽고, 기존 수동 글은 localStorage에 유지합니다.
- 자동 글의 편집은 기존 기능과 동일하게 해당 브라우저에만 저장됩니다. 공용 원문에는 반영되지 않습니다.
- 네트워크 실패 시 마지막 자동 글 캐시를 표시하며 경고를 보여줍니다.
- 기존 로그인 동작을 유지합니다. 목록 열람 전 로그인 화면이 나타날 수 있습니다.
- 기존 import-post.html에 들어 있던 수동 임포트 자료는 `data/legacy-import-post.json`에 보관합니다.

## 검증

```powershell
python -m unittest discover -s tests -p "test_*.py"
node --test tests/published-posts.test.cjs
```

## 참고 문서

- [GitHub Trending](https://github.com/trending?since=daily)
- [GitHub README API](https://docs.github.com/en/rest/repos/contents#get-a-repository-readme)
- [GitHub Actions 예약 실행](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [OpenAI 구조화 응답](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
