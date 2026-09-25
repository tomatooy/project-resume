import { createApiClient } from "@workspace/api/client"
import { accessToken } from "./auth"
import { config } from "./config"
export const api = createApiClient({
  baseUrl: `${config().appOrigin}/api/v1`,
  headers: async () => ({ Authorization: `Bearer ${await accessToken()}` }),
})
