import { errorResponse } from "./errors"
import { createLogger, withLogContext } from "./log"

function routeOf(request: Request): string {
  const path = new URL(request.url).pathname
  if (path === "/api/chat") return "/api/chat"
  if (path.startsWith("/api/v1/")) return "/api/v1/*"
  if (path.startsWith("/_serverFn/")) return "/_serverFn/*"
  if (path.startsWith("/r/")) return "/r/:resumeId/*"
  if (path.startsWith("/skills/")) return "/skills/:skillId"
  if (["/", "/login", "/logout", "/auth/callback", "/skills"].includes(path))
    return path
  return "other"
}

export function logRequest(
  request: Request,
  handle: () => Response | Promise<Response>
): Promise<Response> {
  const requestId = crypto.randomUUID()
  const ray = request.headers.get("cf-ray")
  const method = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ].includes(request.method)
    ? request.method
    : "OTHER"
  return withLogContext(
    {
      requestId,
      cfRay: ray && /^[a-f0-9]{16,32}-[A-Z]{3}$/i.test(ray) ? ray : undefined,
      method,
      route: routeOf(request),
    },
    async () => {
      const log = createLogger()
      const start = performance.now()
      let response: Response
      try {
        response = await handle()
      } catch (error) {
        response = error instanceof Response ? error : errorResponse(error, log)
      }
      const fields = {
        status: response.status,
        latencyMs: Math.round(performance.now() - start),
      }
      if (response.status >= 500) log.error("http_request", fields)
      else if (response.status >= 400) log.warn("http_request", fields)
      // Preserve streaming bodies and cookies while allowing immutable upstream headers.
      const result = new Response(response.body, response)
      result.headers.set("X-Request-Id", requestId)
      return result
    }
  )
}
