---
title: 微信开发者工具环境准备
tags: [WX-ENV, devtools, cli, automation]
updated: 2026-07-22
---

# 微信开发者工具环境准备

本页把可执行的本机准备与项目边界放在一起。命令中的路径、端口、登录状态和版本都是本机**证据**，不是项目配置或行为权威；行为以紧邻的微信官方链接为准。

## WX-ENV-001：从官方来源安装

从[微信开发者工具官方下载页](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)下载并安装官方 DMG。也可运行 `brew install --cask wechatwebdevtools`；[Homebrew cask 定义](https://github.com/Homebrew/homebrew-cask/blob/HEAD/Casks/w/wechatwebdevtools.rb)只说明该 cask 的打包来源，不是微信开发者工具行为的权威。

## WX-ENV-002：首次启动与人工登录

首次启动后由人本人扫描二维码并完成登录；CLI 的登录检查和打开能力以[微信 CLI 文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html)为准。二维码登录是人工操作，绝不自动化或保存二维码、凭据、会话数据、AppID、端口、观察到的绝对路径或机器本地设置到 Git。

完成首次启动和人工登录后，必须把脱敏的运行记录放进已忽略的 `.superpowers/run-evidence`，并在记录中明确确认没有 WXML、WXSS 或 Console 错误；它不能替代官方文档或项目配置。

## WX-ENV-003：定位并配置 CLI

微信 CLI 的能力、参数和登录要求以[微信 CLI 文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html)为准。下面的 zsh 命令只在两个常见应用目录中发现可执行文件；输出是待人工选择的本机证据，不声明通用路径：

```zsh
configure_wechat_cli() {
  typeset -a candidates
  for app_root in /Applications "$HOME/Applications"; do
    [[ -d "$app_root" ]] || continue
    while IFS= read -r candidate; do
      candidates+=("$candidate")
    done < <(find "$app_root" -type f -path '*/Contents/MacOS/cli' -perm -111 -print)
  done
  (( ${#candidates[@]} > 0 )) || { print -u2 'No executable CLI found'; return 1; }
  if (( ${#candidates[@]} == 1 )); then
    selected_cli="$candidates[1]"
  else
    print 'Choose a WeChat DevTools CLI:'
    select selected_cli in "${candidates[@]}"; do
      [[ -n "$selected_cli" ]] || { print -u2 'Choose a numbered candidate'; continue; }
      break
    done
  fi
  WECHAT_DEVTOOLS_CLI="$(realpath "$selected_cli")"
  [[ -f "$WECHAT_DEVTOOLS_CLI" && -x "$WECHAT_DEVTOOLS_CLI" ]] || { print -u2 'Selected CLI is not a regular executable'; return 1; }
  export WECHAT_DEVTOOLS_CLI
}
configure_wechat_cli
```

若有多个候选项，`select` 会显示编号并要求交互选择；随后才运行 `realpath` 和常规可执行文件校验。不要猜测或提交路径。`export WECHAT_DEVTOOLS_CLI` 仅作用于当前 shell；持久化时只能写入已忽略的机器本地环境文件。

CLI 冒烟命令是 `"$WECHAT_DEVTOOLS_CLI" --help`，参数支持以[微信 CLI 文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html)为准。应用版本从已解析 CLI 所在 `.app` 的 `Info.plist` 读取，`--version` **不是**应用版本来源：

```zsh
app_bundle="$(dirname "$(dirname "$(dirname "$WECHAT_DEVTOOLS_CLI")")")"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_bundle/Contents/Info.plist"
```

## WX-ENV-004：端口与自动化边界

`cli auto` 启动的是开发者工具提供的自动化服务；服务启用与连接方式以[小程序自动化快速入门](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html)为准。后续 Task 10 的 `miniprogram-automator` 客户端才是连接该服务的测试代码，不能把它与 IDE CLI 服务混为一谈。

端口关闭或与客户端不匹配时，常见表现是打开失败、连接被拒绝或自动化无法附着。安全处置是人工退出开发者工具，再用一个明确端口重新启动；不得脚本化杀掉 IDE 或自动重配 IDE。端口状态是本机证据，实际 CLI 端口参数以[微信 CLI 文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html)为准。

## WX-ENV-005：导入并构建本项目

从仓库根目录打开项目：

```zsh
cd "$(git rev-parse --show-toplevel)"
npm run env:wechat:check -- --port <positive-integer>
```

本项目的 `project.config.json` 拥有 `miniprogramRoot`；被忽略的 `project.private.config.json` 才放机器/账户私有的 AppID。导入、编译和预览的基本流程以[微信快速开始](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/getstart.html)为准。

`dist/miniprogram-development/` 可以含 preview、Fixture、Scenario 条目；`dist/miniprogram-production/` 必须排除 preview、Fixture、Scenario 条目。两者都不是项目根目录或导入根。不要把生成目录作为导入根，也不要提交私有配置。

稳定失败码及安全修复方向如下：

- `WECHAT_CLI_INVALID`、`WECHAT_VERSION_UNAVAILABLE`：重新选择并验证本机 CLI，使用占位路径 `<local-cli-path>`，不要提交观察到的路径。
- `WECHAT_APPID_REQUIRED`：仅在已忽略的 `<machine-local-private-config>` 配置本机 AppID。
- `WECHAT_BUILD_FAILED`：从仓库根重新执行构建并检查本机构建日志；修复源代码或依赖，不提交构建产物。
- `WECHAT_LOGIN_REQUIRED`：由人重新扫码登录，不保存二维码或会话。
- `WECHAT_OPEN_FAILED`、`WECHAT_PORT_MISMATCH`：人工退出工具，以一个 `<positive-integer>` 端口重开，确认客户端使用同一端口。
- `WECHAT_AUTOMATION_FAILED`：核对服务和客户端边界、登录及端口，再按[自动化快速入门](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html)人工复现。
- `WECHAT_NATIVE_INSPECTION_REQUIRED`：在 Task 6 内用开发者工具原生面板检查，而不是以脚本或浏览器替代。
- 权限：仅在本机授予开发者工具所需的 `<machine-local-permission>`；无权访问时联系设备管理员，不修改仓库。

## WX-ENV-006：故障排查与真机边界

权限、CLI 路径、登录、端口、构建和自动化问题都使用上一节的占位符与最小人工修复；不要记录真实值。开发者工具的调试面板及其用途以[官方调试文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/debug.html)为准。

开发者工具是原生设计真值，但不是 iOS/Android 验收的替代品；工具与客户端对部分能力存在差异，必须在两端真机复验，依据[工具与客户端差异说明](https://developers.weixin.qq.com/miniprogram/dev/devtools/different.html)。
