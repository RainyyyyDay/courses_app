# 从仓库根目录执行；服务需已启动。不会传递任何 API Key。
Invoke-RestMethod -Uri http://127.0.0.1:3001/health
$payload = @{ question = '1+1=?'; student_answer = '3'; error_type = 'careless' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3001/api/ai/classify -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
