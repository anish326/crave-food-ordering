for ($attempt = 0; $attempt -lt 90; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri 'http://localhost:5000/api/menu' -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Start-Process 'http://localhost:5000'
            exit
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}
