import type { User } from "@db/schema";

export interface TrpcContext {
  req: Request;
  resHeaders: Headers;
  user?: User;
}

export async function createContext(opts: { req: Request; resHeaders: Headers }): Promise<TrpcContext> {
  const { req, resHeaders } = opts;
  const cookie = req.headers.get("cookie") || "";
  const tokenMatch = cookie.match(/session_token=([^;]+)/);
  const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : undefined;

  let user: User | undefined;
  if (token) {
    const { getUserFromToken } = await import("./lib/auth");
    const u = await getUserFromToken(token);
    if (u && u.isActive) {
      user = u;
    }
  }

  return { req, resHeaders, user };
}
