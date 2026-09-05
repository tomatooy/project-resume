import type { SessionUser } from "./auth/require-user"
import { requireUser } from "./auth/require-user"
import { createSupabaseForRequest } from "./auth/supabase"
import { createServices, type Services } from "./container"
import { failWith } from "./errors"
import { createLogger, type Logger } from "./log"

export type FnContext<TData> = {
  user: SessionUser
  services: Services
  log: Logger
  data: TData
}

/**
 * The body every server function has: authenticate, build the services
 * against this request's client, run one service call, map anything thrown
 * to an `AppError` with a status.
 *
 * `TData` is inferred from the `.validator(schema)` the call sits under, so a
 * function never restates its input type. The handler does not see the
 * database client: a handler that could reach past the services would be a
 * second place to write a query.
 *
 * Handlers deliberately contain no ownership checks. Authorization is RLS, and
 * a row the caller does not own simply is not returned, which surfaces as
 * NOT_FOUND rather than a distinguishable 403.
 */
export function serve<TData, TResult>(
  handler: (ctx: FnContext<TData>) => Promise<TResult>
): (ctx: { data: TData }) => Promise<TResult> {
  return async ({ data }) => {
    const db = createSupabaseForRequest()
    try {
      const user = await requireUser(db)
      const log = createLogger({
        requestId: crypto.randomUUID(),
        userId: user.userId,
      })
      const services = createServices(db, user.userId)
      return await handler({ user, services, log, data })
    } catch (error) {
      return failWith(error)
    }
  }
}
