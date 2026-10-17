# Veri kaynakları – doğrulama (2026-10-17, curl ile)

| Kaynak | Uç nokta | Sonuç | Kullanım |
|---|---|---|---|
| OKX ATK (stdio MCP) | `market_*` (ticker, tickers, candles, indicator, orderbook, funding, OI, OI geçmişi, OI değişim filtresi, instruments) | **çalışıyor** (anahtarsız, site=tr) | Fiyat, mum, vadeli, enstrüman listesi |
| OKX ATK | `news_*`, `smartmoney_*` | **anahtar gerekiyor** (okx-auth OAuth: "okx-auth rejected the caller") | Haber duygusu: her taramada denenir, yoksa "veri yok" |
| OKX global public | `/api/v5/rubik/stat/contracts/long-short-account-ratio-contract`, `...-top-trader`, `long-short-position-ratio-contract-top-trader`, `/rubik/stat/taker-volume-contract` | **çalışıyor** (`code:"0"`) | Genel ve üst trader L/S, taker hacmi |
| OKX global public | `/api/v5/public/instruments?instType=SPOT` | **çalışıyor** (1184 parite; USDT 443, USDC 298, EUR 272, TRY 133, BTC 3) | Yedek (asıl kaynak ATK) |
| Binance Futures public | `/futures/data/topLongShortAccountRatio`, `/topLongShortPositionRatio`, `/globalLongShortAccountRatio` (period=5m) | **çalışıyor** (HTTP 200, `longShortRatio`, `longAccount`) | L/S tablosu Binance sütunları |
| CoinGecko | `/api/v3/coins/{id}` | **çalışıyor** | Arz yapısı |
| CoinGecko | `/api/v3/coins/{id}/market_chart?days=365&interval=daily` | **çalışıyor** (366 nokta) | Arz değişimi (MC/fiyat, tahmini) |
| DefiLlama | `api.llama.fi/emissions`, `/emission/{protocol}` | **engelli / ücretli** (HTTP 402 "Upgrade to the paid API plan") | Yerine `config/unlocks.json` (ÖRNEK VERİ) |
| Honeypot.is | `api.honeypot.is/v2/IsHoneypot?address=&chainID=` | **çalışıyor** (BSC 56 vb.); Avalanche 43114 **desteklenmiyor** ("Invalid chain") | Güvenlik tablosu sütunu |
| GoPlus | `api.gopluslabs.io/api/v1/token_security/{chainId}` | **çalışıyor** (anahtarsız) | Güvenlik tablosu sütunu |
| OKX OnchainOS | `web3.okx.com/api/v5/dex/...` / `v6` | **anahtar gerekiyor** (v5: "OK-ACCESS-KEY can not be empty", v6: x402 ödeme) | Sütun "anahtar gerekli" gösterir; token arama/bilgi BLOCKED |
| Avalanche Fuji RPC | `api.avax-test.network/ext/bc/C/rpc` | **çalışıyor** | ProofAnchor |
| Telegram Bot API, Gemini API | – | **çalışıyor** (Gemini ücretsiz kota zaman zaman 429) | Bot, mentor |

Lisans kontrolleri:
- AlphaTrend ve Follow Line (Kıvanç Özbilgiç, TradingView): sayfalar "open-source" diyor, ancak lisans başlığı ve kaynak kod sayfadan doğrulanamadı → port edilmedi, kendi ATR trend çizgimiz kullanılıyor, "Follow Line" adı arayüzde geçmiyor.
- TradingView Lightweight Charts: Apache 2.0, atıf logosu korunuyor.
