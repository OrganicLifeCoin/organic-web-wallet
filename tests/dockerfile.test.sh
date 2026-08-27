#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dockerfile="$repo_root/Dockerfile"

postinstall_line=$(awk '/^COPY .*postinstall\.cjs .*\.\/$/ { print NR; exit }' "$dockerfile")
chain_params_line=$(awk '/^COPY .*chain_params\.prod\.json .*\.\/$/ { print NR; exit }' "$dockerfile")
npm_ci_line=$(awk '/^RUN npm ci$/ { print NR; exit }' "$dockerfile")

if [[ -z "$postinstall_line" || -z "$chain_params_line" || -z "$npm_ci_line" \
    || "$postinstall_line" -ge "$npm_ci_line" || "$chain_params_line" -ge "$npm_ci_line" ]]; then
    printf 'Dockerfile must copy postinstall.cjs and chain_params.prod.json before npm ci.\n' >&2
    exit 1
fi

printf 'Dockerfile dependency-install order is valid.\n'
