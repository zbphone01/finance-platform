import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeLockFingerprint } from "./runtime-lock-fingerprint.mjs";

function createLock() {
  return {
    name: "finance-platform",
    version: "10.69.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "finance-platform",
        version: "10.69.0",
        dependencies: { server: "^1.0.0" },
        devDependencies: { builder: "^1.0.0" },
      },
      "node_modules/server": {
        version: "1.0.0",
        integrity: "sha512-server-v1",
      },
      "node_modules/builder": {
        version: "1.0.0",
        integrity: "sha512-builder-v1",
        dev: true,
      },
    },
  };
}

test("项目版本号变化不会改变生产依赖指纹", () => {
  const before = createLock();
  const after = structuredClone(before);
  after.version = "10.70.0";
  after.packages[""].version = "10.70.0";

  assert.equal(
    createRuntimeLockFingerprint(before),
    createRuntimeLockFingerprint(after),
  );
});

test("纯开发依赖变化不会改变生产依赖指纹", () => {
  const before = createLock();
  const after = structuredClone(before);
  after.packages[""].devDependencies.builder = "^2.0.0";
  after.packages["node_modules/builder"] = {
    version: "2.0.0",
    integrity: "sha512-builder-v2",
    dev: true,
  };

  assert.equal(
    createRuntimeLockFingerprint(before),
    createRuntimeLockFingerprint(after),
  );
});

test("生产依赖变化会改变生产依赖指纹", () => {
  const before = createLock();
  const after = structuredClone(before);
  after.packages[""].dependencies.server = "^2.0.0";
  after.packages["node_modules/server"] = {
    version: "2.0.0",
    integrity: "sha512-server-v2",
  };

  assert.notEqual(
    createRuntimeLockFingerprint(before),
    createRuntimeLockFingerprint(after),
  );
});

test("不支持缺少 packages 根条目的锁文件", () => {
  assert.throws(
    () => createRuntimeLockFingerprint({ lockfileVersion: 3, packages: {} }),
    /缺少 packages 根条目/,
  );
});
