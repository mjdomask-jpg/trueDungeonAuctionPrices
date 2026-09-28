<#
.SYNOPSIS
  Regenerate docs/withheld-recompute-preview.csv on a fresh branch from main,
  show what moved, and - only after you type "yes" - commit it and open a PR.

.DESCRIPTION
  The chores in docs/updating-the-data.md ("The withheld preview, and why it no
  longer blocks you"), in one command. It does NOT skip the one step that
  matters: reading the diff. Regenerating over drift you cannot explain destroys
  the check, because the recompute would then be compared against a baseline
  built from the same data. So before anything is committed it prints every
  change sorted into the same buckets validate-context.mjs uses, and waits.

    new rows          a new auction brought withheld rows       expected
    cent moves        |change| <= $0.01, the price cascade      expected
    backfill moves    moved AND its lookback auctions changed   explainable
    UNEXPLAINED       moved with the SAME lookback auctions     stop and look
    removed rows      a withheld row disappeared                stop and look

  Nothing is committed unless you type yes. On a dry run, a "no", or any
  failure, the branch is deleted and you are put back where you started.

.PARAMETER DryRun
  Report what would change, then put everything back. Commits nothing.

.EXAMPLE
  .\scripts\regen-withheld-preview.ps1 -DryRun
.EXAMPLE
  .\scripts\regen-withheld-preview.ps1

.NOTES
  Needs git, node, npm and (unless -DryRun) gh, and a clean working tree.
  Kept to plain ASCII on purpose: Windows PowerShell 5.1 reads a .ps1 without a
  byte-order mark as the ANSI code page, so a typographic dash here would turn
  into mojibake.
#>
[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Preview = 'docs/withheld-recompute-preview.csv'

# One native command. Throws on a non-zero exit, because $ErrorActionPreference
# does not apply to native programs in Windows PowerShell 5.1. Output is never
# redirected: in 5.1, redirecting a native program's stderr (git writes its
# progress there) turns each line into an error record, which 'Stop' then throws.
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments)
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') failed (exit $LASTEXITCODE)" }
}

# One native command whose stdout is wanted, as a trimmed string.
function Get-Native {
  param([string]$Exe, [string[]]$Arguments)
  $out = & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') failed (exit $LASTEXITCODE)" }
  return (($out | Out-String).Trim())
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Text)
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

function ConvertTo-Money {
  param([string]$Text)
  $n = 0.0
  if ([double]::TryParse($Text, [System.Globalization.NumberStyles]::Float,
      [System.Globalization.CultureInfo]::InvariantCulture, [ref]$n)) { return $n }
  return $null
}

function Split-Lookback {
  param([string]$Text)
  if (-not $Text) { return @() }
  return @($Text.Split(';') | Where-Object { $_ })
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repo
$startBranch = $null
$branch = $null
$committed = $false
$failed = $false
$oldPath = $null

try {
  # -------------------------------------------------------------------------
  # Preflight
  # -------------------------------------------------------------------------
  foreach ($tool in @('git', 'node', 'npm')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." }
  }
  if (-not $DryRun -and -not (Get-Command 'gh' -ErrorAction SilentlyContinue)) {
    throw 'gh (GitHub CLI) is not on PATH, and it is needed to open the PR. Use -DryRun to only look.'
  }

  # Tracked changes only: an untracked file rides along a branch switch
  # untouched, and only a tracked edit could be lost or swept into the commit.
  $dirty = Get-Native git @('status', '--porcelain', '--untracked-files=no')
  if ($dirty) { throw "The working tree has uncommitted changes. Commit or stash these first:`n$dirty" }

  $startBranch = Get-Native git @('branch', '--show-current')
  if (-not $startBranch) { $startBranch = Get-Native git @('rev-parse', 'HEAD') }

  Write-Host 'Fetching origin...' -ForegroundColor Cyan
  Invoke-Native git @('fetch', 'origin')

  # A fresh branch name. The repo deletes a head branch when its PR merges, so
  # the date alone is usually free; a second run the same day gets a suffix.
  $base = 'withheld-preview-' + (Get-Date -Format 'yyyy-MM-dd')
  $branch = $base
  $suffix = 2
  while ($true) {
    & git rev-parse --verify --quiet "refs/heads/$branch" | Out-Null
    $local = ($LASTEXITCODE -eq 0)
    $remote = Get-Native git @('ls-remote', '--heads', 'origin', $branch)
    if (-not $local -and -not $remote) { break }
    $branch = "$base-$suffix"; $suffix++
  }

  # From origin/main, never from a publish branch: the repo deletes those as
  # they merge, and main already holds what they published.
  Write-Host "Creating $branch from origin/main..." -ForegroundColor Cyan
  Invoke-Native git @('checkout', '-q', '-b', $branch, 'origin/main')

  # -------------------------------------------------------------------------
  # Regenerate, and compare against the preview main holds
  # -------------------------------------------------------------------------
  $oldPath = Join-Path ([System.IO.Path]::GetTempPath()) ("withheld-preview-main-{0}.csv" -f $PID)
  Copy-Item $Preview $oldPath -Force

  Write-Host 'Running gen-withheld-preview.mjs...' -ForegroundColor Cyan
  Invoke-Native node @('scripts/gen-withheld-preview.mjs')

  & git diff --quiet -- $Preview
  if ($LASTEXITCODE -eq 0) {
    Write-Host ''
    Write-Host 'The preview is already current. Nothing to do.' -ForegroundColor Green
    return
  }

  $old = @(Import-Csv -Path $oldPath -Encoding UTF8)
  $new = @(Import-Csv -Path $Preview -Encoding UTF8)
  $oldByKey = @{}; foreach ($r in $old) { $oldByKey['{0}|{1}' -f $r.auctionId, $r.'item(DisplayName)'] = $r }
  $newByKey = @{}; foreach ($r in $new) { $newByKey['{0}|{1}' -f $r.auctionId, $r.'item(DisplayName)'] = $r }

  $added = @(); $removed = @(); $cent = @(); $backfill = @(); $unexplained = @(); $relabelled = @()
  foreach ($k in $newByKey.Keys) {
    $n1 = $newByKey[$k]
    if (-not $oldByKey.ContainsKey($k)) { $added += $n1; continue }
    $o1 = $oldByKey[$k]
    $ov = ConvertTo-Money $o1.new_PIT_value
    $nv = ConvertTo-Money $n1.new_PIT_value
    if ($null -eq $ov -or $null -eq $nv -or $ov -eq $nv) {
      # Same value. Anything else that changed (status, direction, the inputs
      # list) is worth a line, not a verdict.
      if ($o1.status -ne $n1.status -or $o1.direction -ne $n1.direction -or $o1.lookback_auctions -ne $n1.lookback_auctions) {
        $relabelled += $n1
      }
      continue
    }
    $oldIn = Split-Lookback $o1.lookback_auctions
    $newIn = Split-Lookback $n1.lookback_auctions
    $move = [pscustomobject]@{
      auctionId = $n1.auctionId
      item      = $n1.'item(DisplayName)'
      qty       = $n1.quantity
      was       = $ov
      now       = $nv
      change    = [math]::Round($nv - $ov, 2)
      entered   = (@($newIn | Where-Object { $oldIn -notcontains $_ }) -join ' ')
      left      = (@($oldIn | Where-Object { $newIn -notcontains $_ }) -join ' ')
    }
    $sameInputs = ($o1.lookback_auctions -eq $n1.lookback_auctions) -and ($o1.quantity -eq $n1.quantity)
    if ([math]::Abs($nv - $ov) -le 0.0100001) { $cent += $move }
    # A preview older than the lookback_auctions column cannot say what the
    # inputs were, so a move there is unverified rather than unexplained.
    elseif (-not $o1.lookback_auctions -and $n1.lookback_auctions) { $backfill += $move }
    elseif ($sameInputs) { $unexplained += $move }
    else { $backfill += $move }
  }
  foreach ($k in $oldByKey.Keys) { if (-not $newByKey.ContainsKey($k)) { $removed += $oldByKey[$k] } }

  # -------------------------------------------------------------------------
  # The report
  # -------------------------------------------------------------------------
  Write-Host ''
  Write-Host ('=' * 72)
  Write-Host ("Withheld preview: {0} rows on main -> {1} rows now" -f $old.Count, $new.Count)
  Write-Host ('=' * 72)

  Write-Host ''
  Write-Host ("New rows: {0}  (expected - a new auction brought withheld items)" -f $added.Count) -ForegroundColor Green
  $added | Group-Object auctionId | Sort-Object Name | ForEach-Object {
    Write-Host ("  {0}: {1}" -f $_.Name, (($_.Group | ForEach-Object { $_.'item(DisplayName)' }) -join ', '))
  }

  Write-Host ''
  Write-Host ("Cent moves: {0}  (expected - the price cascade)" -f $cent.Count) -ForegroundColor Green

  Write-Host ''
  Write-Host ("Backfill moves: {0}  (moved because the auctions feeding the estimate changed)" -f $backfill.Count) -ForegroundColor Yellow
  if ($backfill.Count) {
    $backfill | Sort-Object { [math]::Abs($_.change) } -Descending |
      Format-Table auctionId, item, qty, was, now, change, entered, left -AutoSize | Out-String -Width 220 | Write-Host
  }

  if ($relabelled.Count) {
    Write-Host ("Same value, other columns changed: {0}  (status, direction or lookback list)" -f $relabelled.Count) -ForegroundColor Yellow
    $relabelled | Format-Table auctionId, 'item(DisplayName)', status, direction, lookback_auctions -AutoSize | Out-String -Width 220 | Write-Host
  }

  if ($unexplained.Count) {
    Write-Host ''
    Write-Host ("UNEXPLAINED moves: {0}  - same auctions, same quantity, different number" -f $unexplained.Count) -ForegroundColor Red
    Write-Host '  Either a price inside an already-audited window was edited, or the' -ForegroundColor Red
    Write-Host '  recompute itself changed. Do NOT regenerate over this unless you know which.' -ForegroundColor Red
    $unexplained | Sort-Object { [math]::Abs($_.change) } -Descending |
      Format-Table auctionId, item, qty, was, now, change -AutoSize | Out-String -Width 220 | Write-Host
  }

  if ($removed.Count) {
    Write-Host ''
    Write-Host ("Removed rows: {0}  - a withheld row disappeared" -f $removed.Count) -ForegroundColor Red
    $removed | Format-Table auctionId, 'item(DisplayName)', quantity, new_PIT_value -AutoSize | Out-String -Width 220 | Write-Host
  }

  # -------------------------------------------------------------------------
  # Validate: the recompute and the new preview must agree
  # -------------------------------------------------------------------------
  Write-Host ''
  Write-Host 'Running npm run validate...' -ForegroundColor Cyan
  & npm run validate
  if ($LASTEXITCODE -ne 0) {
    $keep = Join-Path ([System.IO.Path]::GetTempPath()) ("withheld-preview-regenerated-{0}.csv" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Copy-Item $Preview $keep -Force
    throw "npm run validate FAILED against the regenerated preview. Nothing was committed. The regenerated file is saved at $keep"
  }

  if ($DryRun) {
    Write-Host ''
    Write-Host 'Dry run: nothing committed. Putting everything back.' -ForegroundColor Cyan
    return
  }

  # -------------------------------------------------------------------------
  # Your call
  # -------------------------------------------------------------------------
  Write-Host ''
  if ($unexplained.Count -or $removed.Count) {
    Write-Host 'There are UNEXPLAINED moves or REMOVED rows above. Answer yes only if you can' -ForegroundColor Red
    Write-Host 'say why each one happened (a deliberate sheet edit, say). If you cannot, answer no.' -ForegroundColor Red
  }
  $answer = Read-Host 'Commit this preview and open a PR? Type yes to go ahead'
  if ($answer -ne 'yes') {
    Write-Host 'Not committed. Putting everything back.' -ForegroundColor Cyan
    return
  }

  $auctions = (@($added | Group-Object auctionId | Sort-Object Name | ForEach-Object { $_.Name }) -join ', ')
  if (-not $auctions) { $auctions = 'none' }
  $summary = @(
    'Regenerate the withheld preview',
    '',
    ("{0} rows on main -> {1} rows now." -f $old.Count, $new.Count),
    '',
    ("- new rows: {0} (auctions: {1})" -f $added.Count, $auctions),
    ("- cent moves (price cascade): {0}" -f $cent.Count),
    ("- backfill moves (lookback auctions changed): {0}" -f $backfill.Count),
    ("- unexplained moves (same inputs): {0}" -f $unexplained.Count),
    ("- removed rows: {0}" -f $removed.Count),
    '',
    'Generated by scripts/regen-withheld-preview.ps1. npm run validate passed',
    'against it, and the diff was reviewed, before commit.'
  ) -join "`n"

  $msgFile = Join-Path ([System.IO.Path]::GetTempPath()) ("withheld-preview-msg-{0}.txt" -f $PID)
  Write-Utf8NoBom $msgFile ($summary + "`n")
  Invoke-Native git @('add', '--', $Preview)
  Invoke-Native git @('commit', '-q', '-F', $msgFile)
  $committed = $true
  Invoke-Native git @('push', '-q', '-u', 'origin', $branch)
  Invoke-Native gh @('pr', 'create', '--base', 'main', '--head', $branch, '--title', 'Regenerate the withheld preview', '--body-file', $msgFile)
  Remove-Item $msgFile -ErrorAction SilentlyContinue

  Write-Host ''
  Write-Host 'Done. Merge the PR once build-and-validate is green; the branch is deleted when it merges.' -ForegroundColor Green
}
catch {
  Write-Host ''
  Write-Host "Stopped: $($_.Exception.Message)" -ForegroundColor Red
  $failed = $true
}
finally {
  # Cleanup must never throw, so no Stop here, and no stderr redirection.
  $ErrorActionPreference = 'Continue'
  if ($branch -and -not $committed) {
    # Put things back: drop the regenerated file, return, delete the branch.
    & git checkout -q -- $Preview
    if ($startBranch) { & git checkout -q $startBranch }
    & git branch -q -D $branch
  }
  elseif ($committed -and $startBranch) {
    # After a commit the branch is the PR's, and it stays.
    & git checkout -q $startBranch
  }
  if ($oldPath) { Remove-Item $oldPath -ErrorAction SilentlyContinue }
  Pop-Location
}
if ($failed) { exit 1 }
