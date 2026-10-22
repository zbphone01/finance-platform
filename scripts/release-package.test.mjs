import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("打包把本地迁移放回包根目录，排除私密目录并拒绝根目录遗留脚本", () => {
  const root = mkdtempSync(join(tmpdir(), "finance-package-test-"));
  const put = (name, value) => {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  };
  try {
    put("src/components/Layout.tsx", 'const APP_VERSION = "v10.85";');
    for (const name of ["dist/boot.js", "dist/public/index.html", "dist/public/assets/app.js", "scripts/runtime-lock-fingerprint.mjs", "scripts/check-v10.85-rule-condition-editor-database.mjs"]) put(name, "fixture\n");
    const script = readFileSync("scripts/release-package.mjs", "utf8");
    const migrations = [...script.matchAll(/"(migrate-[^"\n]+\.sql)"/g)].map((match) => match[1]);
    migrations.push("migrate-v99.01-future.sql");
    for (const name of migrations) put(`database/migrations/${name}`, `-- ${name}\nSELECT 1;\n`);
    for (const name of [".env", ".env.production", "outputs/private.csv", "database/private.sql", "database/migrations/backup.sql", "AGENTS.md"]) put(name, "PRIVATE_FIXTURE\n");
    const run = () => spawnSync(process.execPath, [resolve("scripts/release-package.mjs")], { cwd: root, encoding: "utf8", env: { ...process.env, RELEASE_PACKAGE_OUTPUT: "releases/test.tar.gz" } });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const archive = join(root, "releases/test.tar.gz");
    const members = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" }).stdout.split("\n").map((name) => name.replace(/^\.\//, ""));
    for (const name of migrations) {
      assert.ok(members.includes(name), name);
      assert.equal(spawnSync("tar", ["-xOzf", archive, name], { encoding: "utf8" }).stdout, readFileSync(join(root, "database/migrations", name), "utf8"));
    }
    assert.ok(!members.some((name) => /^(?:database|outputs|\.env|AGENTS\.md)(?:\/|\.|$)/.test(name)));
    put("migrate-stray.sql", "SELECT 1;");
    assert.notEqual(run().status, 0);
    rmSync(join(root, "migrate-stray.sql"));
    rmSync(join(root, "database/migrations", migrations[0]));
    assert.notEqual(run().status, 0, "missing required migration must fail");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
