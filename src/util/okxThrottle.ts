// OKX rubik (public) uç noktaları IP başına ~5 istek / 2 sn ile sınırlı. Vadeli kartı ve Pro L/S aynı kuyruğu paylaşır.
let q: Promise<void> = Promise.resolve();
export function okxRubikSlot(gapMs = 420): Promise<void> {
  if (gapMs <= 0) return Promise.resolve();
  const p = q.then(() => new Promise<void>((r) => setTimeout(r, gapMs)));
  q = p.catch(() => undefined);
  return p;
}
