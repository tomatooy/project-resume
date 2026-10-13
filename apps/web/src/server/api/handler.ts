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
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  })
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
    if (
      new URL(request.url).pathname.startsWith("/api/v1/autofill") &&
      request.body
    ) {
      const reader = request.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > 262144) {
          await reader.cancel()
          return Response.json(
            { code: "VALIDATION", message: "Request too large" },
            { status: 413, headers }
          )
        }
        chunks.push(next.value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      request = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: bytes,
        signal: request.signal,
      })
    }
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
