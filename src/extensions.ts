// Mentor, Telegram ve senaryo gibi uzantıları bağlamaya takar.
import type { AppContext } from "./context.js";

export async function installExtensions(ctx: AppContext): Promise<void> {
  ctx.extras.routes = ctx.extras.routes ?? [];
}
