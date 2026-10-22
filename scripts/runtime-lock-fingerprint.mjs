import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_RUNTIME_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
];

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortObject(child)]),
  );
}

export function createRuntimeLockFingerprint(lock) {
  if (!lock || typeof lock !== "object") {
    throw new Error("package-lock.json 必须是 JSON 对象");
  }
  if (!Number.isInteger(lock.lockfileVersion) || lock.lockfileVersion < 2) {
    throw new Error("只支持 lockfileVersion 2 或更高版本");
  }
  if (!lock.packages || typeof lock.packages !== "object" || !lock.packages[""]) {
    throw new Error("package-lock.json 缺少 packages 根条目");
  }

  const root = lock.packages[""];
  const runtimeRoot = {};
  for (const field of ROOT_RUNTIME_FIELDS) {
    if (root[field] !== undefined) runtimeRoot[field] = root[field];
  }

  const runtimePackages = { "": runtimeRoot };
  for (const [packagePath, packageMetadata] of Object.entries(lock.packages)) {
    if (!packagePath || packageMetadata?.dev === true) continue;
    runtimePackages[packagePath] = packageMetadata;
  }

  const normalized = sortObject({
    lockfileVersion: lock.lockfileVersion,
    packages: runtimePackages,
  });

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

export function fingerprintRuntimeLockFile(lockPath) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  return createRuntimeLockFingerprint(lock);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const lockPath = process.argv[2];
  if (!lockPath) {
    throw new Error("用法：node scripts/runtime-lock-fingerprint.mjs <package-lock.json>");
  }
  process.stdout.write(`${fingerprintRuntimeLockFile(lockPath)}\n`);
}
