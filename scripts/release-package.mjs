import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const layoutSource = readFileSync(resolve(projectRoot, "src/components/Layout.tsx"), "utf8");
const version = layoutSource.match(/const APP_VERSION = "(v\d+(?:\.\d+)+)";/)?.[1];
if (!version) {
  throw new Error("无法从 src/components/Layout.tsx 读取 APP_VERSION");
}

const requiredFiles = [
  "dist/boot.js",
  "dist/public/index.html",
  "scripts/runtime-lock-fingerprint.mjs",
  "scripts/check-v10.85-rule-condition-editor-database.mjs",
  "migrate-v10.74-rule-exclude-conditions.sql",
  "migrate-v10.75-bank-flow-income-expense-view.sql",
  "migrate-v10.76-refund-judge-values.sql",
  "migrate-v10.77-recognized-bank-flow-count-cache.sql",
  "migrate-v10.78-refund-direction-value.sql",
  "migrate-v10.79-keep-unrecognized-bill-details-hot.sql",
  "migrate-v10.80-detail-split-order-dedup.sql",
  "migrate-v10.81-bank-flow-arrival-match.sql",
  "migrate-v10.83-counterparty-match-accounts-source.sql",
];
for (const relativePath of requiredFiles) {
  const absolutePath = resolve(projectRoot, relativePath);
  if (!existsSync(absolutePath) || statSync(absolutePath).size === 0) {
    throw new Error(`发布包必需文件为空或不存在：${relativePath}`);
  }
}

const assetsDir = resolve(projectRoot, "dist/public/assets");
if (!existsSync(assetsDir) || readdirSync(assetsDir).length === 0) {
  throw new Error("发布包必需目录为空或不存在：dist/public/assets");
}

mkdirSync(resolve(projectRoot, "releases"), { recursive: true });
const outputFile = `releases/finance-platform-${version}-local.tar.gz`;
const excludes = [
  "./node_modules",
  "./.git",
  "./releases",
  "./outputs",
  "./database",
  "./.upload-cache",
  "./tmp-sync",
  "./backups",
  "./logs",
  "./backup_before*.sql",
  "./config_from_server*.sql",
  "./finance_config_*.sql",
  "./local_config_backup_*.sql",
  "./prod_config_data_*.sql",
  "./clear_old_budget_codes.sql",
  "./.DS_Store",
  "*.swp",
  "./.env",
  "./.env.*",
  "./AGENTS.md",
];
const tarResult = spawnSync(
  "tar",
  [
    "--no-xattrs",
    "--no-mac-metadata",
    ...excludes.map((value) => `--exclude=${value}`),
    "-czf",
    outputFile,
    ".",
  ],
  {
    cwd: projectRoot,
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    encoding: "utf8",
  },
);
if (tarResult.status !== 0) {
  throw new Error(`生成发布包失败：${tarResult.stderr.trim() || tarResult.stdout.trim()}`);
}

const listResult = spawnSync("tar", ["-tzf", outputFile], {
  cwd: projectRoot,
  encoding: "utf8",
});
if (listResult.status !== 0) {
  throw new Error(`读取发布包失败：${listResult.stderr.trim() || listResult.stdout.trim()}`);
}
const members = listResult.stdout.split("\n").filter(Boolean);
for (const relativePath of requiredFiles) {
  if (!members.some((member) => member.replace(/^\.\//, "") === relativePath)) {
    throw new Error(`发布包缺少必需文件：${relativePath}`);
  }
}
if (!members.some((member) => member.replace(/^\.\//, "").startsWith("dist/public/assets/"))) {
  throw new Error("发布包缺少前端资源：dist/public/assets/");
}
const forbiddenMember = members.find((member) => {
  const normalized = member.replace(/^\.\//, "");
  return /(^|\/)(?:\.env(?:\.[^/]*)?|\.git|node_modules|releases|\.upload-cache|outputs|database|AGENTS\.md)(?:\/|$)/.test(normalized)
    || /(^|\/)\._[^/]*$/.test(normalized)
    || /(^|\/)(?:backup_before[^/]*|config_from_server[^/]*|finance_config_[^/]*|local_config_backup_[^/]*|prod_config_data_[^/]*|clear_old_budget_codes\.sql)$/.test(normalized);
});
if (forbiddenMember) {
  throw new Error(`发布包包含禁止内容：${forbiddenMember}`);
}

console.log(resolve(projectRoot, outputFile));
