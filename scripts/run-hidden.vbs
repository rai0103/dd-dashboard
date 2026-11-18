' 黒い画面（コンソール）を出さずに node のスクリプトを実行する（タスクスケジューラ用）
' 使い方：wscript.exe run-hidden.vbs <node.exeのパス> <スクリプト> [引数...]
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & """" & WScript.Arguments(i) & """ "
Next
sh.Run cmd, 0, True
