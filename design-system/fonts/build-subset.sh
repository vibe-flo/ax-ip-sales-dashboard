#!/usr/bin/env bash
# Pretendard Variable 서브셋 재생성 스크립트.
#
# index.html 은 index.html 하나만 S3로 배포되는 단일 정적 파일이라(README 참고),
# 폰트를 별도 에셋으로 둘 수 없다. 그래서 Pretendard Variable을 wght 400-700(FLO
# 타이포 스케일이 쓰는 regular/medium/semibold/bold), 완성형 한글 전체(U+AC00-D7A3)
# + 라틴/기호로 서브셋한 뒤 base64로 index.html <style> 안에 직접 박아 넣는다.
# 사내망에서 CDN(jsdelivr)이 막혀도 폰트가 항상 로드된다.
#
# 사용법: bash design-system/fonts/build-subset.sh
#   1) python3 -m venv 로 격리된 venv에 fonttools[woff]+brotli 설치
#   2) jsdelivr(npm pretendard@1.3.9)에서 원본 variable woff2(약 2MB) 다운로드
#   3) wght 축을 400-700으로 restrict instancing
#   4) 유니코드 범위로 subset → design-system/fonts/PretendardVariable-subset.woff2 (약 1.1MB)
#   5) base64로 인코딩해 design-system/fonts/PretendardVariable-subset.woff2.b64.txt 에 저장
#
# 서브셋 결과를 index.html 에 다시 넣으려면:
#   python3 - <<'PY'
#   b64 = open('design-system/fonts/PretendardVariable-subset.woff2.b64.txt').read().strip()
#   html = open('index.html', encoding='utf-8').read()
#   import re
#   html = re.sub(
#       r"src:url\(data:font/woff2;base64,[A-Za-z0-9+/=]+\) format\('woff2-variations'\);",
#       f"src:url(data:font/woff2;base64,{b64}) format('woff2-variations');",
#       html, count=1,
#   )
#   open('index.html', 'w', encoding='utf-8').write(html)
#   PY
#
# 커버리지: 완성형 한글 11,172자 전부 포함(회사명·아티스트명 등 자유 입력 필드에
# 어떤 한글이 들어와도 폴백 없이 렌더). 라틴은 기본 ASCII + Latin-1 + 자주 쓰는
# 문장부호(…, →, ₩ 등)만. 필요한 문자가 더 있으면 UNICODES 를 넓히고 재실행한다.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

VERSION="1.3.9"
UNICODES="U+0020-007E,U+00A0-00FF,U+2018-201F,U+2026,U+20A9,U+2192,U+AC00-D7A3,U+3130-318F,U+FF01-FF5E"
WEIGHT_RANGE="wght=400:700"

VENV_DIR="$(mktemp -d)/venv"
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet "fonttools[woff]" brotli

SRC_WOFF2="$(mktemp -d)/PretendardVariable.woff2"
curl -sL "https://cdn.jsdelivr.net/npm/pretendard@${VERSION}/dist/web/variable/woff2/PretendardVariable.woff2" -o "$SRC_WOFF2"

RESTRICTED_TTF="$(mktemp -d)/PretendardVariable-restricted.ttf"
"$VENV_DIR/bin/fonttools" varLib.instancer "$SRC_WOFF2" "$WEIGHT_RANGE" -o "$RESTRICTED_TTF"

"$VENV_DIR/bin/fonttools" subset "$RESTRICTED_TTF" \
  --unicodes="$UNICODES" \
  --output-file="PretendardVariable-subset.woff2" \
  --flavor=woff2 \
  --layout-features='kern,mark,mkmk' \
  --no-notdef-outline --recommended-glyphs

base64 -i PretendardVariable-subset.woff2 > PretendardVariable-subset.woff2.b64.txt

echo "완료: $(du -h PretendardVariable-subset.woff2 | cut -f1) (base64 $(wc -c < PretendardVariable-subset.woff2.b64.txt) bytes)"
echo "index.html 의 @font-face src 를 위 안내대로 교체하세요."
