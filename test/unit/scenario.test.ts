import test from "node:test";
import assert from "node:assert/strict";
import { mkCtx } from "./helpers.js";
import { Scenario } from "../../src/scenario.js";
import { GeminiMentor } from "../../src/mentor/llm.js";
import { MentorTools } from "../../src/mentor/tools.js";

test("senaryo: tarar, KURU emir verir, riskli kararı engeller ve uyarı açar", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  const warnings: string[] = [];
  ctx.warnings.onWarning((w) => warnings.push(w.text));
  const steps = await new Scenario(ctx, 0).start();
  assert.equal(steps.length, 5);
  assert.equal(steps.at(-1)!.done, true);
  assert.equal(ctx.agent.trading.listPositions().length, 1);
  assert.equal(ctx.agent.trading.mode, "KURU");
  assert.ok(warnings.some((w) => w.startsWith("Ajan şu emri sözleşmeye aykırı buldu ve vermedi")));
  assert.equal(ctx.store.follows.length, 1);
  // ikinci çalıştırmada da uyarı çıkar (senaryoya özel anahtar)
  await new Scenario(ctx, 0).start();
  assert.ok(warnings.length >= 2);
});

test("GeminiMentor: düşünme ayarı reddedilirse alansız yeniden dener", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  const bodies: any[] = [];
  const f = (async (_u: string, init: any) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    if (b.generationConfig.thinkingConfig) return new Response('{"error":{"message":"Unknown field thinkingLevel"}}', { status: 400 });
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Tamam." }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const g = new GeminiMentor("k", "gemini-3.8-flash", f);
  assert.equal(await g.reply({ text: "merhaba", history: [], tools: new MentorTools(ctx) }), "Tamam.");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
});
