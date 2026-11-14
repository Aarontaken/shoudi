-- 手递 · 桌面启动器
--
-- 单击图标：打开页面（服务没跑就先拉起来）
-- 把文件拖到图标上：直接投递给手机那一端
-- 图标会一直留在程序坞里；在图标上点右键可以退出
--
-- 所有东西都在 app 包里（Node 运行时 + 服务端 + 页面），
-- 所以这个 app 可以整个拷给别人用。

on run
	launcher({})
end run

-- 已经开着的时候再点一次图标
on reopen
	launcher({})
end reopen

on open theFiles
	set paths to {}
	repeat with f in theFiles
		try
			set end of paths to POSIX path of (f as alias)
		end try
	end repeat
	launcher(paths)
end open

-- 有 idle 处理程序，applet 才会常驻（图标不会一闪就没）
on idle
	return 30
end idle

on quit
	continue quit
end quit

on launcher(paths)
	set launchScript to (POSIX path of (path to me)) & "Contents/Resources/launch.sh"

	set argText to ""
	repeat with p in paths
		set argText to argText & " " & quoted form of (p as text)
	end repeat

	try
		do shell script "/bin/bash " & quoted form of launchScript & argText
	on error errMsg number errNum
		display dialog "手递没能启动。" & return & return & errMsg buttons {"好"} default button 1 with title "手递" with icon caution
	end try
end launcher
