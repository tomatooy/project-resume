import { AppError, createServices } from "@workspace/resume-core"
import { getRequest } from "@tanstack/react-start/server"
import { createSupabaseForRequest } from "../auth/supabase"
import { verifyBearer } from "../auth/bearer"
import { requireUser } from "../auth/require-user"
import { supabasePorts } from "../container"
import { createLogger } from "../log"

export async function createApiContext(request: Request = getRequest()) {
  const authorization = request.headers.get("authorization")
  if (authorization !== null) {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization)
    if (!match?.[1])
      throw new AppError("UNAUTHENTICATED", "Invalid authorization")
    const auth = await verifyBearer(match[1])
    return {
      userId: auth.userId,
      accessToken: auth.accessToken,
      expiresAt: auth.expiresAt,
      services: createServices(supabasePorts(auth.db, auth.userId)),
      log: createLogger({ userId: auth.userId }),
      authKind: "bearer",
    }
  }
  const db = createSupabaseForRequest()
  const user = await requireUser(db)
  const { data, error } = await db.auth.getSession()
  if (error || !data.session?.expires_at)
    throw new AppError("UNAUTHENTICATED", "Sign in again")
  return {
    userId: user.userId,
    accessToken: data.session.access_token,
    expiresAt: data.session.expires_at,
    services: createServices(supabasePorts(db, user.userId)),
    log: createLogger({ userId: user.userId }),
    authKind: "cookie",
  }
}
export type ApiContext = Awaited<ReturnType<typeof createApiContext>>
