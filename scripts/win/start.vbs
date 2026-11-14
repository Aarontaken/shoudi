' 手递 · 双击这个文件就能用
' 作用：悄悄启动 node，交给 launch.mjs 去拉起服务并打开页面。
' 拖到图标上的文件也会作为参数传进去。

Option Explicit

Dim sh, fso, dir, cmd, i

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

dir = fso.GetParentFolderName(WScript.ScriptFullName)

cmd = """" & dir & "\node.exe"" """ & dir & "\app\launch.mjs"""

For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next

sh.CurrentDirectory = dir
sh.Run cmd, 0, False
