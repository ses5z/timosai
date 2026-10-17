// Giriş noktası: npm start
import { loadEnv } from "./config/env.js";
import { createContext, maybeEnableLiveTrading } from "./context.js";
import { createApp } from "./app.js";
import { installExtensions } from "./extensions.js";
import { log } from "./util/log.js";

const env = loadEnv();
const ctx = createContext(env);
await installExtensions(ctx);
const app = createApp(ctx);

const server = app.listen(env.port, async () => {
  log.info(`TimosAI http://localhost:${env.port} (ATK=${env.atkMode}, ${env.live ? "LIVE istendi" : "KURU ÇALIŞMA"})`);
  if (!env.envFileFound) log.warn(".env bulunamadı; anahtar isteyen özellikler kapalı görünecek.");
  else if (ctx.missingEnv.length) log.info(`.env içinde boş satırlar: ${ctx.missingEnv.join(", ")}`);
  await maybeEnableLiveTrading(ctx);
  ctx.agent.start();
  ctx.extras.startBackground?.();
});

const shutdown = async () => {
  ctx.agent.stop();
  ctx.extras.stopBackground?.();
  server.close();
  await (ctx.atk as any)?.close?.();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
