param(
  [string]$To = $env:TEST_TO,
  [string]$Text = $env:TEST_TEXT
)

$baseUrl  = $env:EVOLUTION_BASE_URL
$instance = $env:EVOLUTION_INSTANCE
$apiKey   = $env:EVOLUTION_APIKEY

if (-not $baseUrl -or -not $instance -or -not $apiKey) {
  Write-Host "Missing EVOLUTION_* env vars. Check .env.local (NextIA)." -ForegroundColor Red
  exit 1
}

if (-not $To)   { $To = "5521971287464" }
if (-not $Text) { $Text = "teste NextIA -> Evolution (ps1)" }

$headers = @{ apikey = $apiKey }
$body = @{ number = $To; text = $Text } | ConvertTo-Json

Invoke-RestMethod -Method POST -Headers $headers -ContentType "application/json" `
  -Uri "$baseUrl/message/sendText/$instance" -Body $body
