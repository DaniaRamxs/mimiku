; installer.nsh — hooks personalizados para el instalador de Mimiku
; Cierra cualquier Mimiku corriendo antes de instalar/desinstalar,
; para evitar el error "Error abriendo archivo para escribir".

!macro customInit
  ; matar Mimiku.exe si está corriendo antes de instalar
  nsExec::Exec 'taskkill /F /IM Mimiku.exe /T'
  Sleep 1000
!macroend

!macro customUnInstall
  ; matar Mimiku.exe antes de desinstalar
  nsExec::Exec 'taskkill /F /IM Mimiku.exe /T'
  Sleep 1000
!macroend
