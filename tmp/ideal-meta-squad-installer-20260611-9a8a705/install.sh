#!/usr/bin/env bash
set -euo pipefail

RAW_BASE="${IDEAL_RAW_BASE:-https://raw.githubusercontent.com/eduardocarezia/auto-instaldor/ideal-meta-squad-installer-20260611/tmp/ideal-meta-squad-installer-20260611-9a8a705}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ideal-installer.XXXXXX")"

cleanup() {
  if [[ "${IDEAL_KEEP_TMP:-0}" != "1" ]]; then
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

if ! command -v node >/dev/null 2>&1; then
  echo "IDEAL Installer: Node.js 18+ nao encontrado."
  echo "Instale Node.js e rode novamente."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "IDEAL Installer: curl nao encontrado."
  exit 1
fi

mkdir -p "${TMP_DIR}/bin"

echo "Instalador IDEAL Meta-Squad"
echo "Node: $(node --version)"
echo "Origem: ${RAW_BASE}"
echo

curl -fsSL "${RAW_BASE}/bin/ideal.mjs" -o "${TMP_DIR}/bin/ideal.mjs"
chmod +x "${TMP_DIR}/bin/ideal.mjs"

exec node "${TMP_DIR}/bin/ideal.mjs" ideal:instalar "$@"
