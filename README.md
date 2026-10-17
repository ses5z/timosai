# TimosAI

OKX Agent Trade Kit (ATK) ile çalışan, otonom, trader odaklı kripto ajanı. OKX TR × Team1 Agentic Hackathon için bugün, bu depoda sıfırdan yazıldı.

> Gerçek piyasa verisi, sınırlı bakiye, yatırım tavsiyesi değildir.

Ajan arka planda 28 likit spot çifti tarar. Her coin için spot verisini, vadeli durumunu ve temel yapısını birlikte skorlar. Kararı (aç / izle / ele), giriş/stop/hedefi ve R:R'yi kendisi üretir. Otonom modda küçük, stoplu spot emirleri **kendisi** verip yönetir. Her emir kodda sert limit kapısından geçer; her karar sha256 zincirli bir kayda, kaydın özeti Avalanche'a yazılır. Kullanıcı kartları kaydırarak keşfeder, mentorla risk matematiğini konuşur. Hızlı komutlar varsayılan olarak kapalıdır.

## Kurulum

```bash
npm install
cp .env.example .env   # değerleri kendiniz doldurun; .env repoya girmez
npm start              # http://localhost:3000
```

- Node 20+ gerekir (TypeScript `tsx` ile doğrudan çalışır, derleme adımı yok).
- `.env` yoksa uygulama çökmez; ilgili özellik "kapalı" görünür ve panel, boş satırları yalnızca adlarıyla gösterir.
- Varsayılan `LIVE=false`: **KURU ÇALIŞMA**. Emir ATK'ya gitmez, canlı fiyatla kâğıt üzerinde simüle edilir.

| Değişken | Açıklama |
|---|---|
| `ATK_MODE` | `live` (varsayılan) veya `mock` (örnek veri) |
| `OKX_SITE` | `tr` (varsayılan) |
| `LIVE` | `true` ve bakiye ≥ 1 USDT ise gerçek emir. İlk gerçek emri kullanıcı bilinçli açar. |
| `AUTONOMOUS`, `SCAN_INTERVAL_SEC`, `PAPER_BALANCE_USDT` | Otonom mod, tarama aralığı (30 sn), kuru bakiye (30 USDT) |
| `QUICK_COMMANDS` | `false` (varsayılan): kullanıcı emir yolu yok. `true`: `/al /sat /kapat` ve kaldıraçlı simülasyon |
| `OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE` | Yalnızca hesap ve emir için; piyasa verisi anahtarsız |
| `MENTOR_PROVIDER`, `MENTOR_MODEL`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | Mentor (varsayılan `gemini-3.8-flash`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID` | Telegram botu |
| `AVAX_DEPLOYER_PRIVATE_KEY`, `AVAX_NETWORK` | Avalanche ProofAnchor. Yalnızca bu iş için açılmış **yeni** cüzdan; kişisel cüzdan anahtarı girilmez |

Sırlar ekrana, günlüğe, SSE'ye ve API yanıtlarına düşmez (maskeleme katmanı + testler).

## Adım 0: doğrulama sonuçları

| Kontrol | Sonuç |
|---|---|
| ATK yolu | **(a) çalıştı**: `@okx_ai/okx-trade-mcp` 1.4.8 stdio sunucusu, `@modelcontextprotocol/sdk` istemcisiyle kendi sunucumuzun alt süreci. `--site tr`, kimlik ortam değişkenlerinden, kuru modda `--read-only`. (b) uzak OAuth ve (c) CLI'ye gerek kalmadı. |
| Araç listesi (`--modules market,news,smartmoney`) | 40 araç: `market_*` 20, `news_*` 9, `smartmoney_*` 10, `system_get_capabilities` |
| SWAP verisi (TR) | `market_get_funding_rate`, `market_get_open_interest`, `market_get_oi_history`, `market_filter_oi_change` TR sitesinde anahtarsız çalışıyor; global siteye gerek yok |
| OKX global Trading Statistics | Dört uç nokta `code:"0"` + `data` döndü (genel hesap L/S, üst trader hesap L/S, üst trader pozisyon L/S, taker hacmi). Binance yedeği kodda var, gerek kalmadı |
| ATK `news` / `smartmoney` | OKX OAuth (okx-auth) istiyor; anahtarsız ortamda "veri yok" gösterilir, sahte veri üretilmez |
| GoPlus `token_security/43114` | Tek istekle çalışıyor (Avalanche USDC: PASS) |
| CoinGecko | Arz verisi anahtarsız çalışıyor |

`npm run atk:probe` okuma yolunu tekrar doğrular.

## Veri kaynakları

| Veri | Kaynak | Tür |
|---|---|---|
| Fiyat, 24 sa, hacim, mumlar, RSI, order book (makas/derinlik) | ATK `market_*` | Gerçek |
| Funding, open interest, OI geçmişi, OI değişim filtresi | ATK `market_*` | Gerçek |
| Genel hesap oranı, üst trader oranı (hesap/pozisyon), taker al/sat hacmi | OKX global public Trading Statistics, arayüzde "OKX vadeli verisi (ATK dışı)", 5 dk önbellek | Gerçek |
| Arz, piyasa değeri, FDV | CoinGecko public API | Gerçek |
| DEX token güvenliği | GoPlus Security | Gerçek |
| Haber, smart money | ATK `news` / `smartmoney` | OAuth gerekli; yoksa veri yok |
| Cüzdan dağılımı, OnchainOS güvenlik | OKX OnchainOS | Web3 anahtarı gerekli; yoksa veri yok |
| Kilit açılımı (`config/unlocks.json`), önemli tarihler (`config/events.json`), proje güvenlik özeti | Elle, kaynak linkli | **ÖRNEK VERİ** |
| Kaldıraçlı komutlar | Kâğıt işlem | **SİMÜLASYON** |

ATK çağrı sayacına yalnızca ATK çağrıları sayılır. Public istekler ayrı sayılır.

## Mimari

```
Gözcü döngüsü (30 sn):  Tara → Vadeli + Temel → Güvenlik → Karar → Kapı → Emir → İz → Zincir
                        ATK     ATK + OKX public    makas/   skor + ATR   sözleşme +   OKX TR spot  sha256   Avalanche
                                + CoinGecko         GoPlus   trend + R:R  sert limit   (ATK)        zincir   DecisionLog
Express + SSE ── 7 sayfa (vanilla JS, Basic/Pro) · Mentor (Gemini → Claude → kural) · Telegram (long polling)
```

Portlar ve uygulamaları (`src/ports.ts`; her biri için gerçek ve `Mock*`, `ATK_MODE=live|mock`):

| Port | Gerçek | Örnek / yedek |
|---|---|---|
| `MarketData` | `AtkMarketData` | `MockMarketData`, `ResilientMarketData` (otomatik düşüş) |
| `DerivativesData` | `LiveDerivativesData` (ATK + OKX public, Binance yedeği) | `MockDerivativesData` |
| `NewsFeed` | ATK `news_get_latest` (bildirim motoru içinde) | yok → "veri yok" |
| `FundamentalsData` | `CoinGeckoFundamentals` | `MockFundamentals` |
| `TokenSecurity` | `GoPlusSecurity`, `OnchainOsSecurity` | `MockTokenSecurity` |
| `TradingClient` | `AtkTradingClient` (`LIVE=true`) | `MockTradingClient` (KURU). Kapı ikisinde de aynı |
| `DecisionProvider` | `RuleDecisionProvider` (`config/thresholds.json`) | — |
| `Notifier` | `TelegramBot` (grafik PNG + metin) | `MockNotifier` / önizleme |
| `SignalLedger` | sha256 zincirli kayıt | — |
| `MentorProvider` | `GeminiMentor`, `ClaudeMentor` | `RuleMentor` |
| `ProofAnchor` | `AvalancheProofAnchor` (DecisionLog) | `NoopProofAnchor` |

## Sert limitler (kodda, koşulsuz)

`config/hardlimits.json` yalnızca **sıkılaştırabilir** (`src/trading/hardLimits.ts`). Kapı `TradingClient` içindedir; pop-up, mentor, Telegram, hızlı komut ya da ayar ile aşılamaz.

- Tek emir ≤ 5 USDT · toplam açık ≤ 15 USDT · en fazla 3 açık pozisyon · saatte en fazla 6 emir
- Yalnızca spot, yalnızca izin listesindeki 28 likit USDT çifti, her girişte stop zorunlu
- Çekim, transfer, earn, bot, event, swap/futures/option araçları çağrılamaz (`ToolNotAllowedError`)
- Gerçek emir yalnızca `LIVE=true` ve bakiye ≥ 1 USDT iken

## Risk yönetimi (kilit yok, boyutla yönetilir)

- Zarar sonrası dondurma, durdurma, bekleme ya da geri sayım yoktur.
- Boyut = risk tutarı ÷ stop mesafesi (ATR × k), sert limitlerle kırpılır. İşlem başı risk varsayılan %1 (panelden %0,25–2).
- Art arda 3 zararda boyut yarıya iner, ilk kazançla normale döner (panelde anahtar, varsayılan açık).
- Stop olunan coine süreyle değil, karar "aç" dışına çıkıp yeniden "aç" olunca (yeni kurulum) tekrar girilir.
- R:R eşiği ≥ 2 (hedef 2,2R).
- Günlük zarar 5 USDT'yi geçerse yalnızca uyarı verilir: pop-up, Telegram'a tek mesaj, risk skoru artar.
- **Devre kesici yalnızca teknik arızada açılır:**
  - 5 ardışık API/emir hatası,
  - 60 sn'de 4'ten fazla emir denemesi (döngü hatası),
  - %1,5'ten fazla slipaj.

  Piyasa kaybı tetiklemez. Açılınca ajan yeni emir vermez, nedenini panele ve Telegram'a yazar; kullanıcı panelden "Devam ettir" ile tek tıkla açar.

**Davranış sözleşmesi** (`config/contract.json`): R:R ≥ 2, stop ≤ %6, işlem riski bütçe içinde, risk skoru < 70, makas ≤ %0,25. Ajanın kararı aykırıysa emri göndermez ve uyarı penceresi açılır (tek düğme: Tamam, Esc ile kapanır, aynı uyarı 60 sn içinde tekrar çıkmaz).

## Trader özellikleri

- **D. Vadeli durum** (`config/derivatives.json`). Kurallar:
  - fiyat↑ + OI sert↑ + zayıf spot hacim → vadeli kaynaklı hareket,
  - yüksek funding + yüksek L/S → long squeeze riski (tersi short squeeze),
  - fiyat↑ + negatif funding → short'lar sıkışıyor,
  - üst trader oranı genel hesap oranına zıt → ayrışma,
  - OI ani düşüş + uzun fitil → likidasyon kaskadı.

  Çıktı: kalabalık taraf, manipülasyon şüphesi, gerekçeler. Skora (risk) ve karara girer (şüphe yüksekse "izle"); mentor `vadeli_durum`, Telegram `/vadeli`.
- **C. Haber + hacim + OI bildirimleri** (`config/alerts.json`, `config/events.json`):
  - takip edilen coinler (olumlu): 1 saatlik hacim ≥ 20 saat ortalaması × 3, OI değişim filtresinde öne çıkma, duyarlılık sıçraması, listeleme/ortaklık haberi, 24 saat kalan önemli tarih;
  - eldeki coinler (kritik): hack/exploit/delist/unlock haberi, olağandışı düşüş (15 dk'da −2·ATR + hacim patlaması);
  - BTC sert düşüşte tek "genel piyasa" mesajı.
- **B. Hızlı komutlar** (`QUICK_COMMANDS=true` iken): `/al SOL 5`, `/sat SOL`, `/kapat SOL`. Komutun kendisi onaydır. Tutar 5 USDT'ye kırpılır ve bu söylenir. Zorunlu stop panelden ATR × k ya da % olarak ayarlanır. Günlükte `HIZLI` etiketi. `/l SOL 5x 20`, `/s ETH 3x 10` yalnızca **SİMÜLASYON**: SWAP fiyatı ATK'den, likidasyon fiyatı hesaplanır, gerçek emre dönüşmez. Bayrak kapalıyken `/api/quick` uç noktası yoktur (404).
- **A. Hold raporu**: CoinGecko arzı (dolaşım/toplam/maks, FDV/piyasa değeri), kilit açılımı (ÖRNEK VERİ). Ana zincir coinlerinde cüzdan dağılımı uygulanmaz. Karar üç seçenekten biridir: "kısa vade trade edilebilir", "hold profiline uygun" ya da "ikisi de riskli". Mentor `hold_raporu`, Telegram `/hold`.
- **S. Scam modülü katman 1** (DEX tokenları; OKX listeli coinlere uygulanmaz). Kaynak GoPlus `token_security`: honeypot, vergiler, satış engeli, mint, gizli sahip, bakiye değiştirme, transfer durdurma, kara liste, slipaj değiştirme, LP kilidi. Kural: honeypot → BLOCK; vergi > %10, mint, sahip yetkileri, kilitsiz LP → WARN; aksi PASS. Katman 2 (simülasyon) arayüzde hazır, kararda simülasyon kazanır. Erişim: Keşfet'te arama kutusu, Telegram `/tara`, mentor `token_tara`. Kararlar `SignalLedger`'a yazılır.
- **Trend filtresi**: TimosAI'nin kendi ATR trend göstergesi (`src/indicators/atrTrend.ts`, `config/indicators.json`). Düşüş yönündeyken ajan long açmaz ve kararı "izle" yapar. Pozisyon yönetiminde iz süren stop seçeneği vardır (`trailMode: "atrTrend"`). Birim testi elle hesaplanmış fixture'la (`test/fixtures/atrtrend.json`).

## Avalanche (ProofAnchor)

- `avalanche/contracts/DecisionLog.sol`: kimlik olayı (`Registered`: TimosAI, görevler `scam-scan,opportunity-scan`), `anchor(head, count)` ve `logOutcome(symbol, pnl, hash)`. Değer tutmaz, token çıkarmaz.
- `npm run deploy:fuji`: solc-js ile derler, `.env`'deki `AVAX_DEPLOYER_PRIVATE_KEY` ile Fuji'ye dağıtır ve `avalanche/deployment.fuji.json` yazar. Mainnet için `npm run deploy:mainnet` (chainId 43114).
- Sunucu çalışırken kayıt özeti her `ANCHOR_INTERVAL_MIN` dakikada bir, kapanan işlem sonuçları her kapanışta zincire yazılır. Panelde **Avalanche kanıtı** kartı sözleşme ve Snowtrace işlem linklerini gösterir.
- **Kanıt:** sözleşme adresi ve Snowtrace linki dağıtımdan sonra buraya eklenecek (`avalanche/deployment.fuji.json`).

## Sayfa haritası

Üst gezinmede kalıcı **Basic / Pro** anahtarı vardır (tarayıcıda saklanır). Basic sade dil ve tek etiketlerle çalışır. Pro tüm skor bileşenlerini, vadeli sayıları, hold metriklerini, scam ham alanlarını, ATK günlük ayrıntısını gösterir; grafikte mumlar, hacim, ATR trend çizgisi, al/sat işaretleri ve zaman aralığı vardır.

| Yol | İçerik |
|---|---|
| `/` | Karşılama: logo, dönüşümlü disiplin cümleleri, Mentor ile görüş, Kullanıcı paneline geç |
| `/kesfet` | Token tarama kutusu; aday kartları (vadeli etiketi, sürükle / ← → / geri al); mentor analizi ve grafik; liste görünümü; Mentorla planla |
| `/mentor` | Nabız halkası, HAZIR/DİNLİYOR/DÜŞÜNÜYOR/KONUŞUYOR, Web Speech `tr-TR`, Sustur, onay düğmeleri |
| `/panel` | Değer çizgisi, pozisyonlar, risk kartı (uyarı, engellenen emir, limit çubukları, risk skoru, boyut çarpanı), işlem geçmişi (OTONOM / HIZLI / SENARYO etiketleri), olay günlüğü, ajan durumu ve devre kesici, hızlı mod, ATK çağrıları, Avalanche kanıtı, **Senaryoyu başlat** |
| `/isi-haritasi` | Treemap (boyut hacim, renk değişim veya fırsat/risk). Çekmecede: grafik, ajanın görüşü, skor bileşenleri, vadeli durum, hold raporu, pozisyon, Takibe al, Ajana öncelik ver, Mentora sor. Al/Sat yok. `?s=SOL-USDT` paylaşılabilir |
| `/telegram` | Bağlantı durumu, 4 adım rehber, komut listesi, telefon çerçevesinde canlı önizleme (grafikli), bildirim ayarları |
| `/hakkimizda` | Vizyon, nasıl çalışır (8 adım), veri kaynakları, ekip, yol haritası, ATK araçları, MIT, sorumluluk notu |

Grafikler [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/) ile çizilir (Apache 2.0, `public/vendor/`, CDN yok, varsayılan TradingView atıf logosu açık). Veri bizimdir (ATK mumları).

## Telegram

1. BotFather ile bot açın; jetonu `TELEGRAM_BOT_TOKEN` satırına yazın.
2. Bota `/id` yazın (izinli kullanıcı yokken yalnızca bu komut cevaplanır); gelen sayıyı `TELEGRAM_ALLOWED_USER_ID` satırına yazın.
3. Sunucuyu yeniden başlatın. Bot yalnızca bu kimliğe cevap verir ve başlangıçta eski mesajları atlar.
4. Komutlar: `/kesfet`, `/takip`, `/birak`, `/durum`, `/portfoy`, `/vadeli`, `/hold`, `/tara`, `/bildirim`, `/sessiz 60`, `/ozet`, `/id`, `/yardim`; bayrak açıksa `/al /sat /kapat /l /s`.

Aday kartı ve takip bildirimleri grafik PNG'si ile gider (`node:zlib` ile bağımlılıksız, `sendPhoto` multipart). Hata olursa sparkline'lı metne düşer. Bildirim politikası:
- yalnızca takip edilen ya da eldeki coinler;
- coin başına 30 dk'da 1, saatte en fazla 6 (kritikler hariç);
- aynı içerik tekrar gönderilmez, en fazla iki düğme.

## Demo akışı (10 dk)

Panel → **Senaryoyu başlat**:
1. Canlı tarama.
2. Vadeli durum kartı.
3. Ajan kararı ve KURU spot emir.
4. Sözleşmeye aykırı karar engellenir ve uyarı penceresi açılır.
5. Hızlı komut (bayrak kapalıysa "kapalı" der).
6. Takip edilen coin bildirimi Telegram'a düşer.
7. Token taraması.
8. Avalanche kaydı ve Snowtrace linki.

Ardından canlı olarak Keşfet'te kaydırma, mentorla "SOL analizi", Telegram'da `/vadeli BTC` ve `/kesfet`, ısı haritası çekmecesi.

## Testler

```bash
npm run typecheck
npm test            # node:test (82 test)
npm run test:e2e    # Playwright (bilgisayardaki Microsoft Edge ile; PW_CHANNEL=chromium da olur)
```

## Varsayımlar

- "Saatte 6 emir" yeni girişlere uygulanır; stop/hedef/kısmi kâr çıkışları risk azalttığı için engellenmez.
- Gerçek modda girişte borsaya bağlı stop/hedef konur. Breakeven, iz süren stop ve kısmi kâr ajan tarafından yönetilir; sonrasında kalan miktar için OCO yeniden kurulur.
- Günlük K/Z = bugünkü (UTC) gerçekleşen + açık pozisyonların gerçekleşmemiş K/Z'si. Kuru bakiye 30 USDT, komisyon %0,1.
- AlphaTrend (Kıvanç Özbilgiç) port edilmedi. TradingView sayfası açık kaynak olduğunu belirtiyor, ancak lisans başlığı ve kaynak kod sayfadan doğrulanamadı; doğrulama için gereken TradingView değerleri de alınamadı. Belgedeki kural gereği yerine kendi ATR trend filtremiz yazıldı.
- `ava-labs/8004-boilerplate` yerine en basit uygun yol seçildi: kendi `DecisionLog` sözleşmemiz (kimlik olayı + özet + sonuç sicili). Mainnet'te resmi ERC-8004 registry adresleri mentorlardan alınınca entegre edilebilir.
- Scam demosu için yalnızca GoPlus ile doğrulanmış temiz bir adres eklendi. Doğrulanmış gerçek bir honeypot adresi bulunamadı; uydurulmadı. `config/demo-tokens.json` → `honeypot` alanına eklenip `npm run scam:verify` ile doğrulanmalı.
- Gemini varsayılan modeli resmi model sayfasına göre en güncel kararlı, ücretsiz katmanlı flash: `gemini-3.8-flash`.
- Durum bellektedir; sunucu yeniden başlarsa kuru pozisyonlar, takip listesi ve sohbet sıfırlanır.
- Git'te `user.name` tanımlı olmadığı için commit'ler depo içinde `yy04` adıyla atıldı.

## Yol haritası / bilinen eksikler

- Avalanche Fuji dağıtımı kullanıcının cüzdan anahtarı ve faucet AVAX'ı bekliyor. Mainnet ve resmi ERC-8004 Reputation registry entegrasyonu sonra.
- Scam katman 2 (`anvil --fork-url` ile al/approve/sat simülasyonu) yapılmadı. Karar mantığı simülasyonu destekliyor.
- ATK `news`/`smartmoney` için OKX OAuth, OnchainOS için Web3 API anahtarı gerekli; şimdilik "veri yok".
- Canlı veri sinyal üretmediğinde kayıtlı tarama anını tekrar oynatan "KAYIT" modu yazılmadı. Senaryo düğmesi canlı fiyatlardan deterministik kararlar üretiyor.
- Gerçek emir yolu kodlandı ve kapı testli, ancak geliştirme sırasında `LIVE=true` açılmadı.

## Lisans

MIT (bkz. `LICENSE`). Lightweight Charts: Apache 2.0 (`public/vendor/lightweight-charts.LICENSE.txt`).
