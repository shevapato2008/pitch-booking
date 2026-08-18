# 场馆资料审核运维

场馆介绍和新上传图片必须审核通过后，才会一次性切换为公开版本。设施标签不经过内容审核；审核期间继续展示上一版公开资料。

## 环境变量

API 与 worker 使用同一组部署环境变量：

- 基础运行：`APP_ENV`、`APP_REVISION`、`DATABASE_URL`、`PUBLIC_API_BASE_URL`、`PUBLIC_IMAGE_HOSTS`
- 阿里云 OSS：`OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_PUBLIC_BASE_URL`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`
- DashScope：`DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL`、`DASHSCOPE_MODERATION_MODEL`
- 人工复核权限：`MODERATION_REVIEWER_USER_IDS`

密钥只由部署环境注入，不写入仓库、日志、截图或工单。默认视觉审核模型为 `qwen3-vl-flash`；切换模型前先确认它支持图片输入和结构化 JSON 输出。

## 启动与监控

1. 部署前运行 `uv run alembic upgrade head`。
2. API 启动后，单独持续运行 `uv run python -m backend.app.worker`。
3. 监控 worker 异常日志，并关注长时间停留在 `PENDING`、`CLAIMED` 或 `PENDING_MANUAL` 的审核项。
4. 不确定结果会有限次重试，耗尽后进入人工复核；不要通过直接改库伪造审核通过。

worker 使用数据库租约领取任务。多个实例可以同时运行；异常退出后的任务会在租约到期后重新领取。发布过程保留旧公开资料，直至新版本全部通过并完成原子切换。

## OSS 与小程序域名

- OSS bucket 保持私有；上传原图和审核副本不提供公共读权限。
- 在 OSS CORS 中允许小程序请求来源执行签名 URL 所需的 `PUT`，并允许服务端签发的请求头；不要放宽到不必要的方法或请求头。
- 在微信小程序后台把签名上传 URL 所在 HTTPS 域名加入合法请求域名，把 `OSS_PUBLIC_BASE_URL` 的 HTTPS 域名加入图片下载/展示域名。
- `OSS_PUBLIC_BASE_URL` 仅用于审核通过后的公开对象；审核 URL 必须短时有效。

## 清理策略

为上传临时前缀和审核副本前缀配置 OSS 生命周期清理，保留时间需覆盖审核重试和人工复核窗口。已发布前缀不得套用同一条短期清理规则。发布成功后应用会尽力删除临时对象；生命周期规则负责清理中断上传、失败审核和异常退出留下的孤儿对象。

## 发布后冒烟

1. 检查 API 健康状态、migration 版本和 worker 进程均正常。
2. 用测试场馆账号读取管理页，确认已发布资料仍可见。
3. 修改一段无联系方式的测试介绍，确认产生审核任务，且审核完成前公开端仍展示旧介绍。
4. 在明确允许产生一次模型调用的环境上传一张小尺寸测试场馆图；确认审核通过后介绍与图片一起发布。不要在常规自动化中调用真实 DashScope 或 OSS。
5. 提交过期版本号，确认返回版本冲突且介绍、设施和公开版本均未发生部分写入。
6. 删除测试场馆产生的临时对象；确认公开端不展示场馆电话或其他绕过平台交易入口。
