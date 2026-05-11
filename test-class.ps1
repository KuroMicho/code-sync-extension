# Matar procesos previos para asegurar limpieza
# Stop-Process -Name "Code" -ErrorAction SilentlyContinue

Write-Host "🚀 Lanzando entorno de clase..." -ForegroundColor Cyan

# Lanzar Estudiante
Start-Process "code" -ArgumentList "--extensionDevelopmentPath=$PWD", "--user-data-dir=$PWD/.vscode/user-student", "--new-window"

# Esperar 2 segundos para que no choquen al arrancar
# Start-Sleep -Seconds 2

# Lanzar Estudiante_2
# Start-Process "code" -ArgumentList "--extensionDevelopmentPath=$PWD", "--user-data-dir=$PWD/.vscode/user-student_2", "--new-window"

# Esperar 2 segundos para que no choquen al arrancar
Start-Sleep -Seconds 2

# Lanzar Profesor
Start-Process "code" -ArgumentList "--extensionDevelopmentPath=$PWD", "--user-data-dir=$PWD/.vscode/user-teacher", "--new-window"

Write-Host "✅ Ventanas abiertas. ¡A darle, Profe!" -ForegroundColor Green