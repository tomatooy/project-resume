/// <reference types="@cloudflare/workers-types" />
import type { TailoringEnv } from "./tailoring/runtime"
declare global {
  namespace Cloudflare {
    interface Env extends TailoringEnv {}
  }
}
