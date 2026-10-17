# TimosAI

OKX Agent Trade Kit (ATK) ile çalışan, otonom, kaydırmalı keşifli trader asistanı. OKX TR × Team1 Agentic Hackathon için bugün sıfırdan yazıldı.

> Gerçek piyasa verisi, sınırlı bakiye, yatırım tavsiyesi değildir.

## Kurulum

```bash
npm install
cp .env.example .env   # değerleri kendiniz doldurun; .env repoya girmez
npm start              # http://localhost:3000
```

Node 20+ gerekir. `.env` yoksa uygulama çökmez; anahtar isteyen özellikler "kapalı" görünür.

## ATK yolu (Adım 0)

**Seçilen yol: (a) resmi `@okx_ai/okx-trade-mcp` stdio MCP sunucusu, `@modelcontextprotocol/sdk` istemcisiyle kendi Node sunucumuzun alt süreci olarak.**
Neden: paket npm'de mevcut, `--site tr` ve `OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE` ortam değişkenlerini destekliyor, piyasa araçları anahtarsız gerçek veri döndürüyor ve `--read-only` bayrağıyla emir araçlarını hiç yüklemeden açılabiliyor; uzak OAuth (b) ve CLI (c) yollarına gerek kalmadı.

- Kuru modda (`LIVE=false`) ATK sunucusu `--read-only` ile başlar: emir araçları sunucuda bile yoktur.
- Alt sürece yalnızca `PATH`, `HOME` ve OKX kimlikleri geçer; Gemini/Telegram anahtarları geçmez.
- Her ATK çağrısı `SignalLedger`'a yazılır ve panelde "ATK çağrıları" kartında sayaç + araç listesi olarak görünür.
- Haber duygusu (`news_*`) ve `smartmoney_*` modülleri OKX OAuth kimliği istiyor; anahtarsız ortamda nazikçe devre dışı kalır (nötr kabul edilir, uydurulmaz).
