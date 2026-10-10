param([switch]$WithChat, [switch]$Realistic, [switch]$Stress, [switch]$DbTrace, [ValidateSet(5,10,20)][int]$DelaySeconds = 5)
if ($Realistic -and $Stress) { throw 'Choose one workload' }
if ($Realistic -or $Stress) { $WithChat = $true }
$ErrorActionPreference = 'Stop'
$schatDocker = Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'
$schatRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$endpoint = & $schatDocker --context desktop-linux context inspect desktop-linux --format '{{.Endpoints.docker.Host}}'
if ($LASTEXITCODE -ne 0 -or $endpoint -ne 'npipe:////./pipe/dockerDesktopLinuxEngine') { throw 'Local Docker Desktop required' }
$arguments = @('--context', 'desktop-linux', 'run', '--rm', '--pull', 'never',
  '--name', 'schat-fullapp-smoke', '--network', 'none', '--cpus', '2', '--memory', '3891m',
  '--memory-swap', '3891m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--no-healthcheck', '--tmpfs', '/app/server/storage:rw,uid=1000,gid=1000,mode=0700',
  '--tmpfs', '/tmp:rw,mode=1777', '--env', 'SCHAT_ISOLATED_APP_TEST=explicit-local-only',
  '--env', "SCHAT_TEST_DELAY_SECONDS=$DelaySeconds",
  '--mount', "type=bind,src=$PSScriptRoot,dst=/tests,readonly")
$arguments += @('--mount', "type=bind,src=$PSScriptRoot/empty-config.txt,dst=/app/server/.env,readonly")
# Explicit source allowlist: no .env, host node_modules, storage or document files.
foreach ($part in @('index.js', 'endpoints', 'models', 'utils', 'middleware', 'jobs', 'config', 'prisma')) {
  $source = Join-Path $schatRoot "server/$part"
  $arguments += @('--mount', "type=bind,src=$source,dst=/app/server/$part,readonly")
}
$chromaId = $null
if ($DbTrace) { $arguments += @('--env','SCHAT_TEST_DB_TRACE=1') }
try {
  if ($WithChat) {
    $chromaId = & $schatDocker --context desktop-linux run -d --rm --pull never --network none --label schat.test=isolated-load --tmpfs /data:rw --env ANONYMIZED_TELEMETRY=False chromadb/chroma:1.0.21
    if ($LASTEXITCODE -ne 0 -or $chromaId -notmatch '^[a-f0-9]{64}$') { throw 'Isolated Chroma startup failed' }
    $networkIndex = [Array]::IndexOf($arguments, '--network')
    $arguments[$networkIndex + 1] = "container:$chromaId"
    $arguments += @('--env', 'SCHAT_TEST_CHAT=1')
    if ($Realistic) { $arguments += @('--env', 'SCHAT_TEST_REALISTIC=1') }
    if ($Stress) { $arguments += @('--env', 'SCHAT_TEST_STRESS=1') }
  }
  $arguments += @('--entrypoint', 'node', 'schat-local-schat-web:latest', '/tests/appSmoke.cjs')
  & $schatDocker @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Full app isolated test failed' }
} finally {
  # Only the newly created, empty test container; never the existing Chroma service.
  if ($chromaId -match '^[a-f0-9]{64}$') { & $schatDocker --context desktop-linux stop $chromaId }
}
