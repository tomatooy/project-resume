import { OpenAPIHandler } from "@orpc/openapi/fetch"
import { createApiContext } from "./context"
import { apiError, router } from "./router"

const handler = new OpenAPIHandler(router)
export function checkOrigin(
  request: Request,
  extensionOrigins: string[]
): boolean {
  const origin = request.headers.get("origin")
  const sameOrigin = origin === new URL(request.url).origin
  const bearer = request.headers.has("authorization")
  if (origin && !sameOrigin && !extensionOrigins.includes(origin)) return false
  if (
    request.method !== "GET" &&
    request.method !== "OPTIONS" &&
    !bearer &&
    !sameOrigin
  )
    return false
  return true
}
export async function handleApi(request: Request): Promise<Response> {
  const allowed = (process.env.EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => /^chrome-extension:\/\/[a-p]{32}$/.test(v))
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" })
  if (!checkOrigin(request, allowed))
    return Response.json(
      { code: "VALIDATION", status: 403, message: "Origin not allowed" },
      { status: 403, headers }
    )
  const origin = request.headers.get("origin")
  if (origin && allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type")
  }
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers })
  try {
    const result = await handler.handle(request, {
      prefix: "/api/v1",
      context: await createApiContext(request),
    })
    const response = result.response ?? new Response(null, { status: 404 })
    for (const [key, value] of headers) response.headers.set(key, value)
    return response
  } catch (error) {
    const safe = apiError(error)
    return Response.json(safe.toJSON(), { status: safe.status, headers })
  }
}
