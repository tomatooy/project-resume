import { createApiClient } from "@workspace/api/client"
import { accessToken, session } from "./auth"
import { config } from "./config"
export const api = createApiClient({
  baseUrl: `${config().appOrigin}/api/v1`,
  headers: async () => ({ Authorization: `Bearer ${await accessToken()}` }),
})

export async function apiForAccount(expectedAccountId: string) {
  const current = await session()
  if (!current || current.user.id !== expectedAccountId)
    throw new Error("Account changed")
  const token = current.access_token
  return createApiClient({
    baseUrl: `${config().appOrigin}/api/v1`,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  })
}
