import fs from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import mysql from "mysql2/promise";
import Papa from "papaparse";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const ruleId = Number(process.argv[4] || 27);

if (!inputPath || !outputPath || !ruleId) {
  console.error("Usage: node scripts/export-pending-split.mjs <input.csv> <output.csv> [ruleId]");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("请通过环境变量 DATABASE_URL 提供数据库连接信息。");
  process.exit(1);
}

function cleanCell(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .trim();
}

function normalizeSpaces(value) {
  return cleanCell(value).replace(/\s+/g, " ");
}

function detectEncoding(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "utf-8";
  }
  for (let trim = 0; trim <= Math.min(4, buffer.length); trim += 1) {
    const sample = trim > 0 ? buffer.subarray(0, buffer.length - trim) : buffer;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample);
      return "utf-8";
    } catch {
      // Fall through to GB18030 if the sample is not valid UTF-8.
    }
  }
  return "gb18030";
}

function normalizeDate(value) {
  const cleaned = cleanCell(value).replace(/\//g, "-").split(" ")[0];
  const parts = cleaned.split("-");
  if (parts.length !== 3) return "";
  return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function addDays(dateString, days) {
  const parts = dateString.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return "";
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function rowValue(row, field) {
  return cleanCell(row[cleanCell(field)]);
}

function findHeaderIndex(rows) {
  const knownHeaders = ["订单号", "商户订单号", "发生时间", "收入金额", "收入金额（+元）", "商品名称", "备注"];
  return rows.findIndex((cells) => {
    const cleaned = cells.map(cleanCell).filter(Boolean);
    return cleaned.length >= 3 && !cleaned[0].startsWith("#") && knownHeaders.some((header) => cleaned.some((cell) => cell === header || cell.includes(header)));
  });
}

async function loadRule(connection) {
  const [[rule]] = await connection.query(
    `SELECT id, rule_name, date_field, income_field, order_no_field, detail_split_enabled,
            multi_split_keyword_field, multi_split_keyword
       FROM recognition_rules
      WHERE id = ?`,
    [ruleId],
  );
  if (!rule) throw new Error(`未找到规则 ID ${ruleId}`);
  if (!rule.detail_split_enabled || !rule.multi_split_keyword_field || !rule.multi_split_keyword) {
    throw new Error(`规则 ID ${ruleId} 未开启明细分账或缺少待拆分字段配置`);
  }

  const [items] = await connection.query(
    `SELECT id, keyword_field, detail_keyword, keyword_match_type, sort_order
       FROM rule_items
      WHERE rule_id = ?
      ORDER BY sort_order, id`,
    [ruleId],
  );
  if (!items.length) throw new Error(`规则 ID ${ruleId} 没有规则条件`);
  return { rule, items };
}

function buildMatcher(rule, items) {
  const keywordField = cleanCell(rule.multi_split_keyword_field);
  const splitKeyword = cleanCell(rule.multi_split_keyword);
  const exact = new Set();
  const contains = [];

  for (const item of items) {
    if (cleanCell(item.keyword_field) !== keywordField) continue;
    const keyword = cleanCell(item.detail_keyword);
    if (!keyword) continue;
    const combined = normalizeSpaces(`${keyword} ${splitKeyword}`);
    if (item.keyword_match_type === "包含") {
      contains.push({ combined, item });
    } else {
      exact.add(combined);
    }
  }

  return (row) => {
    const value = normalizeSpaces(rowValue(row, keywordField));
    if (!value) return null;
    if (exact.has(value)) return value;
    const containsMatch = contains.find(({ combined }) => value.includes(combined));
    return containsMatch ? containsMatch.combined : null;
  };
}

const buffer = await fs.readFile(inputPath);
const text = new TextDecoder(detectEncoding(buffer)).decode(buffer);
const parsed = Papa.parse(text, { header: false, skipEmptyLines: true });
if (parsed.errors.length) {
  throw new Error(`CSV解析失败：${parsed.errors[0].message}`);
}

const rows = parsed.data;
const headerIndex = findHeaderIndex(rows);
if (headerIndex < 0) throw new Error("未找到支付宝明细表头");

const headers = rows[headerIndex].map(cleanCell);
const dataRows = rows.slice(headerIndex + 1).map((cells) => {
  const row = {};
  headers.forEach((header, index) => {
    if (header) row[header] = cleanCell(cells[index]);
  });
  return row;
});

const connection = await mysql.createConnection(DATABASE_URL);
try {
  const { rule, items } = await loadRule(connection);
  const matchPendingSplit = buildMatcher(rule, items);
  const outputRows = [];

  for (const row of dataRows) {
    if (!Object.values(row).some((value) => cleanCell(value))) continue;
    const matchedKeyword = matchPendingSplit(row);
    if (!matchedKeyword) continue;

    const orderDate = normalizeDate(rowValue(row, rule.date_field || "发生时间"));
    outputRows.push({
      认账规则ID: String(rule.id),
      认账规则名称: rule.rule_name,
      明细包类型: "T+1",
      订单日期: orderDate,
      T加1到账日期: orderDate ? addDays(orderDate, 1) : "",
      待拆分组合关键字: matchedKeyword,
      ...row,
    });
  }

  const outputCsv = Papa.unparse(outputRows, {
    columns: ["认账规则ID", "认账规则名称", "明细包类型", "订单日期", "T加1到账日期", "待拆分组合关键字", ...headers],
    quotes: true,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `\uFEFF${outputCsv}\n`, "utf8");
  console.log(JSON.stringify({
    inputRows: dataRows.length,
    outputRows: outputRows.length,
    outputPath,
  }, null, 2));
} finally {
  await connection.end();
}
