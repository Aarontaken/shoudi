' 手递 · 在桌面建一个「手递」图标
' 双击运行一次就行，以后点桌面上的图标就能用。

Option Explicit

Dim sh, fso, dir, lnk, desktop, wscriptPath

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
wscriptPath = sh.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
desktop = sh.SpecialFolders("Desktop")

Set lnk = sh.CreateShortcut(desktop & "\手递.lnk")
lnk.TargetPath       = wscriptPath
lnk.Arguments        = """" & dir & "\start.vbs"""
lnk.WorkingDirectory = dir
lnk.IconLocation     = dir & "\shoudi.ico"
lnk.Description      = "手递 · 局域网文件投递"
lnk.Save

MsgBox "桌面图标已经建好了" & vbCrLf & vbCrLf & _
       "「手递」" & vbCrLf & vbCrLf & _
       "双击它就能用，也可以拖到任务栏上。" & vbCrLf & _
       "把文件拖到这个图标上，会直接投递到手机那一端。", _
       vbInformation, "手递"
