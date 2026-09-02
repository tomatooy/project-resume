import { createSupabaseForRequest, type Db } from "./auth/supabase"
import { requireUser, type SessionUser } from "./auth/require-user"
import { createServices, type Services } from "./container"
import { failWith } from "./errors"

export type HandlerContext<TData> = {
  db: Db
  user: SessionUser
  services: Services
  data: TData
}

/**
 * The shape every server function handler has: authenticate, build the
 * services against this request's client, run one service call, map anything
 * thrown to an `AppError` with a status.
 *
 * Handlers deliberately contain no ownership checks. Authorization is RLS, and
 * a row the caller does not own simply is not returned, which surfaces as
 * NOT_FOUND rather than a distinguishable 403.
 */
export function withSupabase<TData, TResult>(
  handler: (ctx: HandlerContext<TData>) => Promise<TResult>
): (ctx: { data: TData }) => Promise<TResult> {
  return async ({ data }) => {
    const db = createSupabaseForRequest()
    try {
      const user = await requireUser(db)
      const services = createServices(db, user.userId)
      return await handler({ db, user, services, data })
    } catch (error) {
      return failWith(error)
    }
  }
}
