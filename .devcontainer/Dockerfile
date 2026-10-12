FROM mcr.microsoft.com/devcontainers/python:1-3.11-bookworm

# 기본 이미지에 들어 있는 Yarn apt 저장소의 서명 키를 검증하지 못해
# 뒤이어 설치되는 desktop-lite 기능의 `apt-get update`가 실패한다.
# 이 프로젝트는 Yarn을 쓰지 않으므로 해당 저장소 목록만 제거한다.
RUN grep -rl "dl.yarnpkg.com" /etc/apt/sources.list.d/ 2>/dev/null | xargs -r rm -f || true
