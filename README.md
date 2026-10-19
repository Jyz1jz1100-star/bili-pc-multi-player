# bili-pc-multi-player

哔哩哔哩 PC 客户端（Windows，Electron）**多视频同播补丁**：每个视频开一个独立播放窗口，可同时播放多个视频；同一个视频也可以重复多开。

> 本仓库只包含补丁工具，**不含客户端任何代码或资源**。请自行安装官方客户端。

## 原理

客户端播放窗口是主进程里的单例 `configService.playerWindow`：点视频只会 `show()` 那个唯一窗口并换片。
补丁做两件事（业务代码不改）：

1. `tools/shim.js`：以 shim 形式插在加密主进程包前，包装 `ipcMain.handle('window/openPlayerWindow')` —
   真实点击时让旧窗口对单例检查“看起来已销毁”，客户端自己走创建分支新开窗口；并修正多窗口下的关闭语义。
2. `deobf/patch-renderer-marker.mjs`：给渲染层唯一的开窗请求加上“真实用户动作”标记，
   非用户触发的请求不开新窗口，避免无限开窗。

补丁通过替换 `%APPDATA%\bilibili\resource\<hash>.asar` 中的 `main/.biliapp` 与渲染层 chunk 实现；
客户端启动时从该 asar 重新生成 `.biliapp`/`.bilijsc` 与校验哈希，因此不会触发缓存失效回退。

## 使用

要求：Windows、PowerShell、Node.js 18+、Python 3.8+，并**先完全退出哔哩哔哩客户端**。

```powershell
pwsh -File tools\rebuild-asar.ps1    # 生成 build\app.asar.patched
pwsh -File tools\install-patch.ps1   # 安装（自动备份到 backup\）
```

卸载：

```powershell
pwsh -File tools\uninstall-patch.ps1
```

客户端**自动更新会覆盖补丁**，更新后重跑上面两条即可。

## 文件

| 路径 | 说明 |
|---|---|
| `tools/shim.js` | 主进程 shim（补丁本体） |
| `deobf/patch-renderer-marker.mjs` | 渲染层用户动作标记补丁 |
| `tools/rebuild-asar.ps1` | 由当前客户端 asar 生成补丁 asar |
| `tools/install-patch.ps1` / `uninstall-patch.ps1` | 安装 / 还原 |
| `tools/*.cjs`、`tools/asar.py` | asar 解包、AES 解密/加密、bundle 拼接等零件 |

## 已知限制

- 播放窗口被完全遮挡或失焦时，B 站播放器自身会暂停；把窗口并排放好即可同时播放。
- “关闭播放窗口”仍是隐藏而非销毁（原版行为），多开时被隐藏的窗口不会自动回收。
- 托盘/部分快捷操作只作用于最新的播放窗口（原版单例语义）。

## 免责声明

仅供个人学习与研究使用，风险自负。请勿用于分发受版权保护的客户端代码或资源。
