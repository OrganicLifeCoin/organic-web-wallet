#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dockerfile="$repo_root/Dockerfile"

postinstall_line=$(rg -n '^COPY .*postinstall\.cjs .*\./$' "$dockerfile" | cut -d: -f1)
chain_params_line=$(rg -n '^COPY .*chain_params\.prod\.json .*\./$' "$dockerfile" | cut -d: -f1)
npm_ci_line=$(rg -n '^RUN npm ci$' "$dockerfile" | cut -d: -f1)

if [[ -z "$postinstall_line" || -z "$chain_params_line" || -z "$npm_ci_line" \
    || "$postinstall_line" -ge "$npm_ci_line" || "$chain_params_line" -ge "$npm_ci_line" ]]; then
    printf 'Dockerfile must copy postinstall.cjs and chain_params.prod.json before npm ci.\n' >&2
    exit 1
fi

printf 'Dockerfile dependency-install order is valid.\n'
