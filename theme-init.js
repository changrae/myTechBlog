// CSS 적용 전에 테마를 결정해 다크모드 플래시를 방지합니다.
// CSP(script-src 'self')를 지키기 위해 인라인 스크립트 대신 별도 파일로 둡니다.
(function () {
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) { /* storage blocked */ }
    if (saved !== 'dark' && saved !== 'light') saved = null;
    var prefersDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
})();
