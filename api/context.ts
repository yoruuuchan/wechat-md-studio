import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { createVisitorResolver, type VisitorResolver } from "./lib/visitor";
import { authenticateRequest } from "./session";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
  /**
   * Request-scoped, shared by every procedure in a tRPC batch. One request gets
   * one visitor identity and at most one Set-Cookie — see createVisitorResolver.
   */
  visitorIdentity: VisitorResolver;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = {
    req: opts.req,
    resHeaders: opts.resHeaders,
    visitorIdentity: createVisitorResolver(opts.req.headers, opts.resHeaders),
  };
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch {
    // Authentication is optional here
  }
  return ctx;
}
