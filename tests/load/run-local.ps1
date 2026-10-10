param([ValidateSet(5,10,20)][int[]]$Delays = @(5,10,20))
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$dockerPath = if ($dockerCommand) { $dockerCommand.Source } else {
  Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'
}
if (-not (Test-Path -LiteralPath $dockerPath)) { throw 'Docker Desktop CLI not found' }
$endpoint = & $dockerPath --context desktop-linux context inspect desktop-linux --format '{{.Endpoints.docker.Host}}'
if ($LASTEXITCODE -ne 0 -or "$endpoint".Trim() -ne 'npipe:////./pipe/dockerDesktopLinuxEngine') {
  throw 'Only the local Docker Desktop named pipe is permitted'
}
foreach ($seconds in $Delays) {
  & $dockerPath --context desktop-linux run --rm --pull never `
    --name "schat-admission-load-$($seconds)s" --network none `
    --cpus 2 --memory 3891m --memory-swap 3891m --read-only `
    --cap-drop ALL --security-opt no-new-privileges --user 1000:1000 `
    --mount "type=bind,src=$repoPath/tests/load,dst=/app/tests/load,readonly" `
    --mount "type=bind,src=$repoPath/server/utils/chatAdmission.js,dst=/app/server/utils/chatAdmission.js,readonly" `
    --mount "type=bind,src=$repoPath/server/utils/chatAdmissionSession.js,dst=/app/server/utils/chatAdmissionSession.js,readonly" `
    --mount "type=bind,src=$repoPath/server/utils/helpers/abortSignals.js,dst=/app/server/utils/helpers/abortSignals.js,readonly" `
    node:18-slim node /app/tests/load/runAdmissionLoad.cjs $seconds --isolated-load-test
  if ($LASTEXITCODE -ne 0) { throw "Load fixture failed: $seconds seconds" }
}
