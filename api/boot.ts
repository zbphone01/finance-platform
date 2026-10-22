import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { runDailyDedup } from "./lib/counterpartySync";
import { startDiskUsageSnapshotCollector } from "./lib/diskUsageSnapshot";
import { getUserFromToken } from "./lib/auth";
import { uploadOrderDetailsFromStream } from "./lib/orderUploadStream";
import { uploadInvoiceOnlyOrderDetailsFromStream } from "./lib/invoiceOnlyOrderUpload";
import {
  completeOrderUploadSession,
  createOrderUploadSession,
  getOrderUploadSession,
  writeOrderUploadChunk,
} from "./lib/orderUploadSessions";
import {
  completeDetailSplitUploadSession,
  createDetailSplitUploadSession,
  getDetailSplitUploadSession,
  writeDetailSplitUploadChunk,
} from "./lib/detailSplitUploadSessions";

const app = new Hono<{ Bindings: HttpBindings }>();

async function getAuthedUploadUser(c: any) {
  const cookie = c.req.header("cookie") || "";
  const tokenMatch = cookie.match(/session_token=([^;]+)/);
  const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : undefined;
  const user = token ? await getUserFromToken(token) : null;
  return user && user.isActive ? user : null;
}

function isKnownOrderUploadError(message: string) {
  return /上传的订单明细有无订单号条目|未找到订单号|订单号为空|无法解析账单日期|日期或时间格式异常|账单日期.*格式异常|收入金额格式异常|未找到收入金额|订单明细文件缺少列|请选择有效的到账日期|发现已认账订单|没有匹配该明细认账规则到账信息|存在多条可能匹配的银行流水|判断字段.*(?:退款值|收支方向值)|退款及收支方向判断异常|所选认账规则|所选明细认账规则|所选不认账明细规则|创建订单|Duplicate entry|Unknown column|Data truncated|Incorrect decimal value|Out of range value|Field .* doesn't have a default value|Column .* cannot be null|Data too long/.test(message);
}

app.post("/api/order-files/upload-session", async (c) => {
  const user = await getAuthedUploadUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);

  try {
    const body = await c.req.json().catch(() => ({}));
    const session = await createOrderUploadSession({
      userId: user.id,
      ruleType: body.ruleType === "invoice_only" ? "invoice_only" : "recognition",
      ruleId: Number(body.ruleId || 0),
      matchDate: body.matchDate ? String(body.matchDate) : undefined,
      fileName: String(body.fileName || "订单明细.csv"),
      fileSize: Number(body.fileSize || 0),
      lastModified: Number(body.lastModified || 0),
      chunkSize: Number(body.chunkSize || 0),
    });
    return c.json(session);
  } catch (err: any) {
    return c.json({ error: err?.message || "创建上传任务失败" }, 400);
  }
});

app.put("/api/order-files/upload-chunk", async (c) => {
  const user = await getAuthedUploadUser(c);
  if (!user || !user.isActive) return c.json({ error: "请先登录" }, 401);
  const uploadId = String(c.req.query("uploadId") || "");
  const index = Number(c.req.query("index"));
  if (!c.req.raw.body) return c.json({ error: "分片内容为空" }, 400);

  try {
    const session = await writeOrderUploadChunk({
      uploadId,
      userId: user.id,
      index,
      body: c.req.raw.body,
    });
    return c.json(session);
  } catch (err: any) {
    return c.json({ error: err?.message || "分片上传失败" }, 400);
  }
});

app.post("/api/order-files/upload-complete", async (c) => {
  const user = await getAuthedUploadUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);

  try {
    const uploadId = String(c.req.query("uploadId") || "");
    const matchDate = c.req.query("matchDate") ? String(c.req.query("matchDate")) : undefined;
    const session = await completeOrderUploadSession(uploadId, user.id, matchDate);
    return c.json(session);
  } catch (err: any) {
    return c.json({ error: err?.message || "文件合并失败" }, 400);
  }
});

app.get("/api/order-files/upload-session/:uploadId", async (c) => {
  const user = await getAuthedUploadUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);

  try {
    const session = await getOrderUploadSession(c.req.param("uploadId"), user.id);
    return c.json(session);
  } catch (err: any) {
    return c.json({ error: err?.message || "上传任务不存在" }, 404);
  }
});

app.post("/api/detail-split-files/upload-session", async (c) => {
  const user = await getAuthedUploadUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);

  try {
    const body = await c.req.json().catch(() => ({}));
    const session = await createDetailSplitUploadSession({
      userId: user.id,
      ruleId: Number(body.ruleId || 0),
      matchField: String(body.matchField || ""),
      incomeField: String(body.incomeField || ""),
      recognitionKeywordField: String(body.recognitionKeywordField || ""),
      fileName: String(body.fileName || "明细分账.csv"),
      fileSize: Number(body.fileSize || 0),
      lastModified: Number(body.lastModified || 0),
      chunkSize: Number(body.chunkSize || 0),
    });
    return c.json(session);
  } catch (err: any) {
    return c.json({ error: err?.message || "创建上传任务失败" }, 400);
  }
});

app.put("/api/detail-split-files/upload-chunk", async (c) => {
  const user = await getAuthedUploadUser(c);
  if (!user || !user.isActive) return c.json({ error: "请先登录" }, 401);
  const uploadId = String(c.req.query("uploadId") || "");
  const index = Number(c.req.query("index"));
  if (!c.req.raw.body) return c.json({ error: "分片内容为空" }, 400);

  try {
    const session = await writeDetailSplitUploadChunk({
      uploadId,
      userId: user.id,
      index,
      body: c.req.raw.body,
    });
    return c.json(session);
  } catch (err: any) {
    return c.json({ error: err?.message || "分片上传失败" }, 400);
  }
});

app.post("/api/detail-split-files/upload-complete", async (c) => {
  const user = await getAuthedUploadUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);

  try {
    const uploadId = String(c.req.query("uploadId") || "");
    const session = await completeDetailSplitUploadSession(uploadId, user.id);
    return c.json(session);
  } catch (err: any) {
    return c.json({ error: err?.message || "文件合并失败" }, 400);
  }
});

app.get("/api/detail-split-files/upload-session/:uploadId", async (c) => {
  const user = await getAuthedUploadUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);

  try {
    const session = await getDetailSplitUploadSession(c.req.param("uploadId"), user.id);
    return c.json(session);
  } catch (err: any) {
    return c.json({ error: err?.message || "上传任务不存在" }, 404);
  }
});

app.post("/api/order-files/upload-stream", async (c) => {
  const user = await getAuthedUploadUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);

  const ruleId = Number(c.req.query("ruleId") || 0);
  const ruleType = c.req.query("ruleType") === "invoice_only" ? "invoice_only" : "recognition";
  const matchDate = c.req.query("matchDate") ? String(c.req.query("matchDate")) : undefined;
  const fileName = decodeURIComponent(c.req.query("fileName") || "订单明细.csv").slice(0, 200);
  if (!ruleId) return c.json({ error: ruleType === "invoice_only" ? "请选择不认账明细规则" : "请选择认账规则" }, 400);
  if (!c.req.raw.body) return c.json({ error: "请选择订单明细文件" }, 400);

  try {
    const result = ruleType === "invoice_only"
      ? await uploadInvoiceOnlyOrderDetailsFromStream({
        stream: c.req.raw.body,
        fileName,
        ruleId,
        userId: user.id,
      })
      : await uploadOrderDetailsFromStream({
        stream: c.req.raw.body,
        fileName,
        ruleId,
        userId: user.id,
        matchDate,
      });
    return c.json(result);
  } catch (err: any) {
    const message = err?.message || "";
    const dbCause = err?.cause || err;
    const dbMessage = dbCause?.sqlMessage || dbCause?.message || message;
    console.error("[order-files/upload-stream] 上传订单明细失败:", {
      name: err?.name,
      code: dbCause?.code,
      errno: dbCause?.errno,
      sqlState: dbCause?.sqlState,
      sqlMessage: dbCause?.sqlMessage,
      message: dbMessage,
    });
    return c.json({ error: isKnownOrderUploadError(dbMessage) ? dbMessage : "明细识别失败，请检查文件" }, 400);
  }
});

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  startDiskUsageSnapshotCollector();

  // 每天自动执行一次未记录到账信息滤重（首次启动后1分钟执行，之后每24小时）
  const ONE_DAY = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    runDailyDedup().then((r) => console.log(`[dailyDedup] initial sync: ${r.synced} items`)).catch((e) => console.error('[dailyDedup] initial failed:', e));
    setInterval(() => {
      runDailyDedup().then((r) => console.log(`[dailyDedup] synced: ${r.synced} items`)).catch((e) => console.error('[dailyDedup] failed:', e));
    }, ONE_DAY);
  }, 60 * 1000);
}
