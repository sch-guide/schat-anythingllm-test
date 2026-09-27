$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$compose = Get-Content -LiteralPath (Join-Path $repo "docker/docker-compose.yml") -Raw
$required = @(
  "schat-core/src/__init__.py",
  "schat-core/src/controlled_generation.py",
  "schat-core/src/evidence.py",
  "schat-core/src/evidence_routing.py",
  "schat-core/src/query.py",
  "schat-core/src/library.py",
  "schat-core/src/chunking.py",
  "schat-core/src/medical_terms.py",
  "schat-core/src/settings.py",
  "schat-core/src/prompt_config.py",
  "schat-core/src/config/prompts/registry.yaml",
  "schat-core/src/config/prompts/v1.0-natural-grounded.yaml",
  "schat-core/tools/__init__.py",
  "schat-core/tools/evaluation_action_strength.py"
)

if ($compose -match '\.\./\.\./(?:src|tools)') {
  throw "docker-compose.yml still mounts files outside the repository"
}
if ($compose -notmatch '\.\./schat-core/src:/schat-core/src:ro') {
  throw "repository-local src mount is missing"
}
if ($compose -notmatch '\.\./schat-core/tools/evaluation_action_strength\.py:/schat-core/tools/evaluation_action_strength\.py:ro') {
  throw "repository-local tool mount is missing"
}

foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $repo $relative) -PathType Leaf)) {
    throw "missing required safety file: $relative"
  }
}

$forbidden = Get-ChildItem -LiteralPath (Join-Path $repo "schat-core") -Recurse -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq "__pycache__" -or $_.Name -eq ".env" -or $_.Extension -eq ".pyc" }
if ($forbidden) {
  throw "forbidden runtime or secret files exist under schat-core"
}

$gitignore = Get-Content -LiteralPath (Join-Path $repo ".gitignore") -Raw
if ($gitignore -notmatch '(?m)^schat-core/\*\*/\.env\*$') {
  throw "schat-core nested .env ignore rule is missing"
}

Write-Output "SCHAT core self-contained checks passed."
