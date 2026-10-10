# Exercise the round-2 features against a running Reed instance.
#   pwsh -File scripts/test-round2.ps1 -Base http://127.0.0.1:3199 -EnvFile .env
#   pwsh -File scripts/test-round2.ps1 -Base https://wechat.yoru-and-akari.dev -AccessEmail you@example.com
param(
    [string]$Base = 'http://127.0.0.1:3199',
    [string]$EnvFile = '.env',
    [string]$AccessKey = '',
    # When the site sits behind Cloudflare Access, requests need an identity header.
    [string]$AccessEmail = ''
)

$ErrorActionPreference = 'Stop'

if ($AccessEmail) {
    $headers = @{
        'Cf-Access-Authenticated-User-Email' = $AccessEmail
        'Cf-Access-Jwt-Assertion'            = 'script-test'
    }
} else {
    $headers = @{}
}

if (-not $AccessKey) {
    $AccessKey = ((Get-Content $EnvFile | Where-Object { $_ -match '^ACCESS_KEY=' }) -replace '^ACCESS_KEY=', '').Trim()
}

$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Post-Trpc([string]$path, [hashtable]$payload) {
    $body = @{ json = $payload } | ConvertTo-Json -Depth 20 -Compress
    (Invoke-WebRequest -Uri "$Base/api/trpc/$path" -Method Post -ContentType 'application/json' `
        -Body $body -WebSession $sess -Headers $headers -UseBasicParsing).Content | ConvertFrom-Json
}
function Get-Trpc([string]$path) {
    (Invoke-WebRequest -Uri "$Base/api/trpc/$path" -WebSession $sess -Headers $headers -UseBasicParsing).Content | ConvertFrom-Json
}

Write-Host '=== login ==='
$r = Post-Trpc 'auth.login' @{ accessKey = $AccessKey }
Write-Host "  success=$($r.result.data.json.success)"

Write-Host ''
Write-Host '=== docs.list on empty db ==='
$r = Get-Trpc 'docs.list'
Write-Host "  rows=$($r.result.data.json.Count)"

Write-Host ''
Write-Host '=== docs.save ==='
Post-Trpc 'docs.save' @{ id='test-doc-1'; name='验收稿件'; content="# 标题`n"; updatedAt=1791300000000 } | Out-Null
Write-Host '  saved'

Write-Host '=== docs.save again updates in place (not a duplicate) ==='
Post-Trpc 'docs.save' @{ id='test-doc-1'; name='改过名'; content="# 改过了`n"; updatedAt=1791300005000 } | Out-Null
$r = Get-Trpc 'docs.list'
Write-Host "  rows=$($r.result.data.json.Count) name=$($r.result.data.json[0].name)"

Write-Host ''
Write-Host '=== docs.importLocal skips ids that already exist ==='
$r = Post-Trpc 'docs.importLocal' @{ docs=@(
    @{ id='test-doc-1'; name='已有的'; content='x'; updatedAt=1 },
    @{ id='test-doc-2'; name='新导入'; content='y'; updatedAt=2 }
) }
Write-Host "  imported=$($r.result.data.json.imported) (expect 1)"

Write-Host ''
Write-Host '=== upload two images, reference only one ==='
$png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
$usedKey = $null
# Track exactly what this script creates. Never delete by "everything that is
# there" - that is how an earlier version of this test destroyed a real upload
# that only existed in someone's unsaved draft.
$ourKeys = @()
foreach ($n in @('used','orphan')) {
    $r = Post-Trpc 'storage.upload' @{ name="$n.png"; contentBase64=$png; contentType='image/png' }
    $k = $r.result.data.json.key
    $ourKeys += $k
    Write-Host "  $n -> $k"
    if ($n -eq 'used') {
        $usedKey = $k
        Post-Trpc 'docs.save' @{ id='test-doc-1'; name='验收稿件'; content="引用 img:$k"; updatedAt=1791300010000 } | Out-Null
    }
}

Write-Host ''
Write-Host '=== storage.stats ==='
$r = Get-Trpc 'storage.stats'
Write-Host "  count=$($r.result.data.json.count) totalBytes=$($r.result.data.json.totalBytes) quota=$($r.result.data.json.quotaBytes)"

Write-Host ''
Write-Host '=== storage.orphans (expect exactly the unreferenced one) ==='
$r = Get-Trpc 'storage.orphans'
$orphans = $r.result.data.json
foreach ($o in $orphans) { Write-Host "  orphan: $($o.name)" }
Write-Host "  count=$($orphans.Count)"
if ($orphans.Count -ne 1) { throw "expected exactly 1 orphan, got $($orphans.Count)" }
if ($orphans[0].key -eq $usedKey) { throw 'the referenced image was wrongly flagged as an orphan' }

Write-Host ''
Write-Host '=== removeOrphans ==='
$keys = @($orphans | ForEach-Object { $_.key })
$r = Post-Trpc 'storage.removeOrphans' @{ keys=$keys }
Write-Host "  deleted=$($r.result.data.json.deleted) freed=$($r.result.data.json.freedBytes)"

Write-Host ''
Write-Host '=== stats after cleanup (expect count=1, the referenced one) ==='
$r = Get-Trpc 'storage.stats'
Write-Host "  count=$($r.result.data.json.count)"
if ($r.result.data.json.count -ne 1) { throw "expected 1 file left, got $($r.result.data.json.count)" }

Write-Host ''
Write-Host '=== removeOrphans refuses to delete anything still referenced ==='
# Save a doc that points at the surviving image, then ask for it by name.
$r = Get-Trpc 'storage.list'
$survivor = @($r.result.data.json)[0].key
Post-Trpc 'docs.save' @{ id='test-doc-1'; name='引用稿'; content="img:$survivor"; updatedAt=1791300020000 } | Out-Null
$r = Post-Trpc 'storage.removeOrphans' @{ keys=@($survivor) }
Write-Host "  deleted=$($r.result.data.json.deleted) skipped=$(@($r.result.data.json.skipped).Count)"
if ($r.result.data.json.deleted -ne 0 -or @($r.result.data.json.skipped).Count -ne 1) {
    throw 'the guard let a referenced image through'
}
$r = Get-Trpc 'storage.stats'
if ($r.result.data.json.count -ne 1) { throw "guard test: expected the image to survive, count=$($r.result.data.json.count)" }
Write-Host '  guard OK: referenced image survives an explicit delete request'

Write-Host ''
Write-Host '=== teardown (only our own keys) ==='
Post-Trpc 'docs.remove' @{ id='test-doc-1' } | Out-Null
Post-Trpc 'docs.remove' @{ id='test-doc-2' } | Out-Null
$r = Post-Trpc 'storage.removeOrphans' @{ keys=$ourKeys }
Write-Host "  removed our $($ourKeys.Count) test image(s): deleted=$($r.result.data.json.deleted)"
$r = Get-Trpc 'storage.stats'; Write-Host "  files left: $($r.result.data.json.count)"
$r = Get-Trpc 'docs.list';  Write-Host "  docs left: $(@($r.result.data.json).Count)"
Write-Host 'ALL ROUND-2 CHECKS PASSED'
