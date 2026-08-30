# C2c 到场记录 Development Preview 实施计划

> **执行范围：** `DELEGATED_APPROVED_FOR_PREVIEW`。本计划只实现 development-only Fixture、原生页面、聚焦测试与视觉自审；不得实现生产契约/迁移/后端，不得合并、部署或上传体验版。

**目标：** 在微信开发者工具中提供一条真实可操作的“队长逐人记录散客到场/未到场”原生预览，并证明所有预览资产不会进入 production build。

**基线：** `e8529557e06308c69a93ffe9e5c6f90d0e5e348b`

**设计：** [C2c 队长赛后到场记录基础设计](../specs/2026-08-30-attendance-recording-foundation-design.md)

**实现原则：** 复用 C2b 已确认的导航、蓝灰卡片、确认层、触控尺寸和安全区模式；用一份隔离 Fixture store 驱动场景入口与名单页。页面按钮必须改变 Fixture 状态或执行真实导航，production 构建必须完全排除 marker、路由和 source。

---

## Task 1：建立隔离的到场 Fixture 状态机

**文件：**

- 新建：`miniprogram/dev/c2c-attendance-fixture.ts`
- 新建：`miniprogram/dev/c2c-attendance-fixture.test.ts`

### 1.1 先写失败测试

覆盖最小状态：

- `MIXED`：一名 `UNMARKED`、一名 `PRESENT`、一名 `NO_SHOW`；
- `COMPLETE`：所有人均已记录；
- `EMPTY`：没有 JOINED 散客；
- `LOAD_ERROR`、`CONFLICT`、`UNKNOWN_RESULT`；
- `openDecision(registrationId, PRESENT|NO_SHOW)` 只允许 `UNMARKED`；
- `confirmDecision()` 真实写入 Fixture、记录固定时刻、关闭面板并更新 `recorded/total`；
- `closeDecision()` 不改变名单；
- `resolveConflict()` 和 `confirmUnknownResult()` 均进入权威 Fixture 快照，不伪造 Toast 成功；
- `retryLoad()` 使 `LOAD_ERROR → MIXED`，提供真实加载恢复；
- `reset()` 使测试和重复视觉检查可重放。

运行：

```bash
npx jest --runInBand miniprogram/dev/c2c-attendance-fixture.test.ts
```

预期：首次因模块不存在失败。

### 1.2 最小实现

冻结唯一 marker：

```ts
export const C2C_ATTENDANCE_FIXTURE_MARKER = "C2C_ATTENDANCE_FIXTURE";
```

数据仅包含球局摘要、本场称呼、意向位置、到场结果、记录时间及预览状态；不得放入手机号、微信号、真实 user ID、成年/风险确认或报名备注。

实现一份同步内存 store，不引入持久化、网络层或生产抽象。所有场景使用确定性时间和文案，便于截图比较。

### 1.3 验证并提交

```bash
npx jest --runInBand miniprogram/dev/c2c-attendance-fixture.test.ts
git diff --check
git add miniprogram/dev/c2c-attendance-fixture.ts miniprogram/dev/c2c-attendance-fixture.test.ts
git commit -m "test: add C2c attendance preview fixture"
```

---

## Task 2：添加可重放场景入口

**文件：**

- 新建：`miniprogram/dev/c2c-attendance-pages.json`
- 新建：`miniprogram/dev/pages/c2c-attendance-scenario/index.ts`
- 新建：`miniprogram/dev/pages/c2c-attendance-scenario/index.json`
- 新建：`miniprogram/dev/pages/c2c-attendance-scenario/index.wxml`
- 新建：`miniprogram/dev/pages/c2c-attendance-scenario/index.wxss`
- 新建：`miniprogram/dev/pages/c2c-attendance-scenario/index.test.ts`

### 2.1 先写失败测试

断言：

- inventory 只声明 scenario 与 attendance 两条 custom-navigation development route；
- 场景入口呈现“混合名单、全部完成、空名单、加载失败、状态冲突、未知结果”六个按钮；
- 每个按钮先选择对应 Fixture 场景，再真实 `navigateTo` 到名单页；
- 返回按钮执行 `navigateBack`，没有历史栈时 `reLaunch` 到 `/pages/intent-entry/index`；
- 预览标识明确写“C2c 开发预览 · 模拟数据”。

### 2.2 最小页面实现

沿用既有开发场景页的自定义导航、卡片和按钮，不建立新的设计 token 文件。所有按钮最小高度 `88rpx`，显式双轴居中并提供 `hover-class`。

### 2.3 验证并提交

```bash
npx jest --runInBand miniprogram/dev/pages/c2c-attendance-scenario/index.test.ts
npm run typecheck
git diff --check
git add miniprogram/dev/c2c-attendance-pages.json miniprogram/dev/pages/c2c-attendance-scenario
git commit -m "feat: add C2c attendance preview scenarios"
```

---

## Task 3：实现原生到场名单与确认交互

**文件：**

- 新建：`miniprogram/dev/pages/c2c-attendance/index.ts`
- 新建：`miniprogram/dev/pages/c2c-attendance/index.json`
- 新建：`miniprogram/dev/pages/c2c-attendance/index.wxml`
- 新建：`miniprogram/dev/pages/c2c-attendance/index.wxss`
- 新建：`miniprogram/dev/pages/c2c-attendance/index.test.ts`

### 3.1 先写页面行为测试

覆盖：

- `onLoad/onShow` 从 store 投影球局摘要、稳定名单和 `已记录 X / Y`；
- 未记录行的“到场/未到场”打开正确确认层；
- 返回名单关闭层且不写入；
- 确认按钮调用 Fixture transition，重复点击不会重复写入；
- 记录完成后按钮消失、徽标和时间出现；
- 最后一名被记录后出现完成提示；
- 加载失败调用 `retryLoad()`，冲突调用 `resolveConflict()`，未知结果调用 `confirmUnknownResult()`；
- 空名单按钮返回场景入口；名单页没有历史栈时也 `redirectTo` 到场景入口；
- header 返回在有/无页面栈时均有真实行为；
- 页面不可分享。

模板测试额外断言每个 `<button>` 都绑定真实 handler，确认层关闭 X 完整，按钮文案准确，不出现“微信昵称”“实名”“信用分”或“已通知”。

### 3.2 实现名单页

结构：

```text
自定义导航“到场记录”
→ 可滚动内容
  → “C2c 开发预览 · 模拟数据”标识
  → 本场已结束摘要卡
  → 已记录 X / Y
  → JOINED 散客卡片列表
  → 完成提示或真实空态
→ 底部确认层（仅选择后出现）
```

视觉要求：

- 复用 `#F8FAFC / #FFFFFF / #10243E / #526479 / #0284C7` 与现有绿色/红色语义；
- 两个行内按钮用两列 grid，同宽、同高、文字 flex 双轴居中；
- `PRESENT` 与 `NO_SHOW` 同尺寸徽标并沿同一列对齐；
- 较长本场称呼单行省略，不能推挤徽标或按钮；
- 根容器使用 `height: 100vh; display: flex; flex-direction: column; overflow: hidden`；滚动容器同时使用 `flex: 1 1 auto; height: 0; min-height: 0`，并以静态测试锁定这组规则，内容底部包含 safe area；
- 确认层 scrim 约 48%，关闭 X 为 CSS 矢量，不使用 emoji 或模糊位图；
- 不设置固定底栏，避免名单被遮挡。

### 3.3 聚焦验证并提交

```bash
npx jest --runInBand \
  miniprogram/dev/c2c-attendance-fixture.test.ts \
  miniprogram/dev/pages/c2c-attendance-scenario/index.test.ts \
  miniprogram/dev/pages/c2c-attendance/index.test.ts
npm run typecheck
npx eslint \
  miniprogram/dev/c2c-attendance-fixture.ts \
  miniprogram/dev/c2c-attendance-fixture.test.ts \
  miniprogram/dev/pages/c2c-attendance-scenario/index.ts \
  miniprogram/dev/pages/c2c-attendance-scenario/index.test.ts \
  miniprogram/dev/pages/c2c-attendance/index.ts \
  miniprogram/dev/pages/c2c-attendance/index.test.ts
git diff --check
git add miniprogram/dev/pages/c2c-attendance
git commit -m "feat: preview C2c attendance recording"
```

---

## Task 4：证明 development/production 隔离

**文件：**

- 新建：`tests/attendance-native-preview.test.mjs`
- 修改：`scripts/audit-production-package.mjs`
- 修改：`tests/audit-production-package.test.mjs`
- 修改：`tests/production-package-booking-audit.test.mjs`

### 4.1 先写隔离失败测试

新增拒绝 token：

- `C2C_ATTENDANCE_FIXTURE`
- `c2c-attendance-fixture`
- `c2c-attendance-pages.json`
- 两条 `dev/pages/c2c-attendance...` 路由；
- `C2c 开发预览 · 模拟数据`
- 确定性 fixture game/registration ID 与球局名称。

`attendance-native-preview.test.mjs` 验证 development build 包含两条预览 route，fresh production build 不含任一 marker、route 或 source。

### 4.2 更新生产审计并验证

只扩展既有禁止列表，不改变构建架构。

```bash
node --test \
  tests/attendance-native-preview.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
MINIPROGRAM_PAYMENT_PROVIDER=disabled \
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

预期：development app manifest 含两条 C2c route；production manifest 与所有文件均无 C2c marker。

### 4.3 提交隔离证明

```bash
git diff --check
git add tests/attendance-native-preview.test.mjs \
  scripts/audit-production-package.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
git commit -m "test: isolate C2c attendance preview"
```

---

## Task 5：官方微信开发者工具视觉自审

**产物：** 临时截图只保存到 `/tmp/c2c-attendance-visual.*`，不提交仓库。

### 5.1 构建与打开 development 包

```bash
npm run build:miniprogram:development
/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
  --project "$PWD" --auto-port 9431 --trust-project
```

CLI/automator 不能切换 IDE 机型，但可以在当前机型上断言、导航和截图。优先复用已存在的 `/tmp/c1c-automator.yionQe/node_modules/miniprogram-automator@0.12.1`；若不存在，只在临时目录安装 pinned `0.12.1`，不修改仓库依赖：

```bash
c2c_automator_root=/tmp/c1c-automator.yionQe
if [ ! -f "$c2c_automator_root/node_modules/miniprogram-automator/package.json" ]; then
  c2c_automator_root="$(mktemp -d /tmp/c2c-automator.XXXXXX)"
  npm install --prefix "$c2c_automator_root" --no-save miniprogram-automator@0.12.1
fi
mkdir -p /tmp/c2c-attendance-visual
C2C_AUTOMATOR_ROOT="$c2c_automator_root" node --input-type=module <<'NODE'
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const automator = require(`${process.env.C2C_AUTOMATOR_ROOT}/node_modules/miniprogram-automator`);
const mini = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9431" });
const info = await mini.systemInfo();
await mini.reLaunch("/dev/pages/c2c-attendance-scenario/index");
const page = await mini.currentPage();
const documentSize = await page.size();
console.log(JSON.stringify({
  model: info.model,
  screen: { width: info.screenWidth, height: info.screenHeight },
  window: { width: info.windowWidth, height: info.windowHeight },
  document: documentSize,
}));
await mini.screenshot({ path: "/tmp/c2c-attendance-visual/scenario.png" });
await mini.disconnect();
NODE
```

只有命令输出的 model 与 `screenWidth/screenHeight` 符合当前视觉目标，才继续通过页面按钮进入以下 route。`windowWidth/windowHeight` 记录实际小程序窗口；`documentSize.width` 用于排查横向溢出，而可滚动长页的 `documentSize.height` 可以大于 `windowHeight`，内容可达性由实际滚动检查：

```text
/dev/pages/c2c-attendance-scenario/index
```

### 5.2 iOS 代表状态

在 iPhone 12/13 Pro `390 × 844` 检查并截取：

- 混合名单；
- “确认未到场”确认层；
- 全部完成；
- 空名单。

人工检查按钮双轴居中、同行列对齐、徽标一致、箭头/X 完整、无裁切、滚动与安全区、文案和数字准确。只做一轮代表性复核；发现明显问题时做最小修复后重拍相关状态。

### 5.3 Android 代表状态

官方 CLI/automator 不能切换机型，只能操作开发者工具当前选择的机型。若 Computer Use 可用，则在 IDE 底部设备栏按可见文本选择 `Nexus 5X (411 × 731)`，再用 automator 断言 model/viewport 并重复上述四个状态。

若本轮 Computer Use 原生管道仍不可用，停止工具链排障并将 Android 门保持为 `PENDING`；不得使用 iOS、静态 411×731 渲染或历史截图冒充 Android DevTools 证据。

### 5.4 视觉复核后的聚焦回归

```bash
npx jest --runInBand \
  miniprogram/dev/c2c-attendance-fixture.test.ts \
  miniprogram/dev/pages/c2c-attendance-scenario/index.test.ts \
  miniprogram/dev/pages/c2c-attendance/index.test.ts
node --test tests/attendance-native-preview.test.mjs
npm run typecheck
git diff --check
```

如有视觉修复，单独提交：

```bash
git add miniprogram/dev/pages/c2c-attendance
git commit -m "fix: refine C2c attendance preview"
```

---

## Task 6：独立审核、技术备份与视觉门

### 6.1 独立审核

安排两个只读审核：

- 规格/范围审核：确认没有生产接入、身份真实性承诺或可逆性谎言；
- 代码/视觉审核：确认每个按钮有真实行为、Fixture 隔离、无 Critical/Important。

只修复本预览范围内的 Critical/Important，不扩展为后端或全量回归。

### 6.2 最终本地验证

```bash
git status --short --branch
git log --oneline --decorate -6
git diff --check e8529557e06308c69a93ffe9e5c6f90d0e5e348b..HEAD
```

允许把独立 feature branch push 作为技术备份；禁止 merge、deploy、upload。只有 iOS 与真实 Nexus 5X DevTools 的四个代表状态都通过后，才可标记“视觉候选冻结”并交给用户复核。Android 为 `PENDING` 时只能报告已实现/已备份，不能声称视觉自审通过、不能交付为视觉候选，也不能开启生产实施计划。最终报告必须分别列出 iOS、Android、用户视觉、后端、真机和 C2b 外部门状态，不能以“模块完成”概括未过门的 foundation。

### 6.3 后续（不在本计划执行）

视觉门通过后另开生产实施计划，依次完成封闭契约、`0021`、后端事务、生产客户端、未知结果恢复、玩家回读、双账号 staging、production audit 与双真机验收。C2d 纠错真实落地前仍不得称 C2c 生产完成。
