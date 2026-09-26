@echo off
setlocal DisableDelayedExpansion
set "signTool=%XRK_DESKTOP_WINDOWS_SIGNTOOL%"
set "certificateFile=%XRK_DESKTOP_WINDOWS_CER_FILE%"
set "tokenPin=%XRK_DESKTOP_WINDOWS_TOKEN_PIN%"
set "keyContainer=%XRK_DESKTOP_WINDOWS_KEY_CONTAINER%"
set "targetFile=%XRK_DESKTOP_WINDOWS_SIGN_TARGET%"
set "appendSignature="
if "%XRK_DESKTOP_WINDOWS_SIGN_APPEND%"=="1" set "appendSignature=/as"
set "XRK_DESKTOP_WINDOWS_SIGNTOOL="
set "XRK_DESKTOP_WINDOWS_CER_FILE="
set "XRK_DESKTOP_WINDOWS_TOKEN_PIN="
set "XRK_DESKTOP_WINDOWS_KEY_CONTAINER="
set "XRK_DESKTOP_WINDOWS_SIGN_TARGET="
set "XRK_DESKTOP_WINDOWS_SIGN_APPEND="
set "signTool=" & set "certificateFile=" & set "tokenPin=" & set "keyContainer=" & set "targetFile=" & set "appendSignature=" & "%signTool%" sign /v /fd sha256 /f "%certificateFile%" /kc "[{{%tokenPin%}}]=%keyContainer%" /csp "eToken Base Cryptographic Provider" %appendSignature% "%targetFile%"
exit /b %errorlevel%
