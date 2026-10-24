@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
    echo Python bulunamadi.
    echo Lutfen Python 3.10 veya daha yeni bir surum kurun ve kurulumda "Add Python to PATH" secenegini isaretleyin.
    echo https://www.python.org/downloads/windows/
    pause
    exit /b 1
)
python --version
python app.py
if errorlevel 1 (
    echo.
    echo Uygulama baslatilamadi. Yukaridaki hata mesajini kontrol edin.
    pause
)
