# 本地沙盒说明

本目录是从 `finance-platform-v9.12.3.tar.gz` 解压出来的本地副本，用于功能升级、构建验证和本地模拟。

## 当前状态

- 源码已展开到当前 `sandbox` 目录。
- 原部署包包含 `.env`，数据库地址指向本机 MySQL：`localhost:3306/finance_recon`。
- 当前机器没有检测到 Docker 或 MySQL 命令，因此完整后端模拟需要先准备 MySQL。
- 当前会话中依赖安装命令被权限复核超时拦截，尚未生成 `node_modules`。

## 推荐本地环境

1. 安装依赖：

```bash
npm ci
```

2. 准备本地 MySQL，并创建沙盒数据库：

```sql
CREATE DATABASE finance_recon_sandbox CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'finance_sandbox'@'localhost' IDENTIFIED BY 'finance_sandbox_password';
GRANT ALL PRIVILEGES ON finance_recon_sandbox.* TO 'finance_sandbox'@'localhost';
FLUSH PRIVILEGES;
```

3. 使用 `.env.sandbox` 中的本地配置覆盖 `.env`，避免误连其他环境。

4. 推送数据库结构：

```bash
npx drizzle-kit push
```

如遇交互式命令卡住，可使用：

```bash
script -q -c "npx drizzle-kit push --force" /dev/null
```

5. 启动本地开发服务：

```bash
npm run dev
```

默认访问地址：`http://localhost:3000`。

## 验证命令

```bash
npm run check
npm run build
```

## 重要提醒

- 不要把生产数据库连接写入本地 `.env`。
- 在做功能升级前，优先在这个沙盒目录中修改和验证。
- 如果需要导入生产数据样例，建议先脱敏并只导入少量样本。
