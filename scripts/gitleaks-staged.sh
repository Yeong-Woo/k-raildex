#!/bin/sh
# 커밋 전 비밀값 검사(CLAUDE.md 6절). gitleaks 가 설치돼 있지 않으면 경고만 한다(CI 에서는 항상 검사).
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --staged --redact --no-banner || exit 1
else
  echo "[gitleaks] 설치되지 않아 로컬 비밀값 검사를 건너뜀(CI 에서 검사함)" >&2
fi
