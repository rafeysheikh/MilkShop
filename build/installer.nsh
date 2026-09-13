!macro customInstall
  CreateDirectory "$INSTDIR\backup"
  FileOpen $0 "$INSTDIR\backup\README.txt" w
  FileWrite $0 "=== DOODH KHATA BACKUP RESTORE FOLDER ===$\r$\n$\r$\n"
  FileWrite $0 "Paste your previous backup file (.json) into this folder.$\r$\n"
  FileWrite $0 "When Doodh Khata starts (or via Settings > Load from Backup Folder),$\r$\n"
  FileWrite $0 "it will automatically load your previous data into the application.$\r$\n"
  FileClose $0
!macroend

!macro customUnInstall
  RMDir /r "$DOCUMENTS\MilkShop"
  RMDir /r "$APPDATA\milkshop-doodh-khata"
  RMDir /r "$LOCALAPPDATA\milkshop-doodh-khata"
  RMDir /r "$LOCALAPPDATA\milkshop-doodh-khata-updater"
!macroend
