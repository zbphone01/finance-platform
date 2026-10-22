# v9.99-local 版本快照

## 发布范围

- 本版用于增强登录安全，新增登录限速、账号锁定和验证器 App 二次验证。
- 右上角系统版本号更新为 `v9.99`。
- 部署包：`releases/finance-platform-v9.99-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 登录安全

- 登录接口增加 IP 限速：同一 IP 每分钟最多 3 次登录尝试。
- 账号密码连续错误 3 次后锁定账号，锁定后只能由管理员在账号管理页解锁。
- 账号管理页新增锁定状态展示和管理员解锁操作。
- 登录成功、用户修改密码或管理员重置密码时，会清零失败次数。

## 验证器 App

- 任意账号登录后，如未绑定验证器 App，会弹出绑定提示，用户可选择稍后处理。
- 用户可使用 Microsoft Authenticator、Google Authenticator、1Password 等验证器 App 扫码绑定。
- 绑定成功后，下次登录流程改为先输入用户名和密码，再输入验证器 App 动态验证码。
- 二次验证码通过后才会创建正式登录会话。
- 账号管理页新增验证器绑定状态展示，管理员可重置用户的验证器绑定。

## 数据库迁移

- 本版新增数据库迁移：`migrate-v9.98-login-lockout.sql`、`migrate-v9.99-two-factor-auth.sql`。
- 已部署 v9.97 的环境，部署 v9.99 代码前需要按顺序执行这两个迁移。
- 如果目标环境尚未部署 v9.97，需要先执行 `migrate-v9.97-role-permissions.sql`，再执行本版两个迁移。

## 本地验证

- 本地已执行 `migrate-v9.98-login-lockout.sql` 和 `migrate-v9.99-two-factor-auth.sql`，并确认字段存在。
- `npm run check` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 发布包完整性检查通过，未包含 `.env`、`node_modules`、`dist`、`.git`。
