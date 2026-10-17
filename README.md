# TimosAI

OKX Agent Trade Kit (ATK) ile çalışan, otonom, kaydırmalı keşifli trader asistanı. OKX TR × Team1 Agentic Hackathon için bugün, bu depoda sıfırdan yazıldı.

> Gerçek piyasa verisi, sınırlı bakiye, yatırım tavsiyesi değildir.

Yapay zekanın taradığı coinler tek tek kart olarak gelir; kaydırarak elersin ya da listene alırsın. Mentor, ne kadar alınabileceğini risk matematiğiyle anlatır (boyutu kod hesaplar). Ajan arka planda tarar, seçer ve otonom modda uygun sinyalde küçük, stoplu emirleri **kendisi** verip yönetir. Kullanıcı emir veremez (yarışma kuralı: işlemleri ajan yapar). Davranış sözleşmesi uyarır, kilitlemez.

## Kurulum

```bash
npm install
cp .env.example .env   # değerleri kendiniz doldurun; .env repoya girmez
npm start              # http://localhost:3000
```

- Node 20+ gerekir (TypeScript `tsx` ile doğrudan çalışır, derleme adımı yok).
- `.env` yoksa uygulama çökmez; anahtar isteyen özellikler "kapalı" görünür ve panel, `.env` içinde hangi satırların boş olduğunu (yalnızca adlarıyla) söyler.
- Varsayılan `LIVE=false`: **KURU ÇALIŞMA**. Emirler ATK'ya gitmez, canlı fiyatla kâğıt üzerinde simüle edilir.

| Değişken | Açıklama |
|---|---|
| `ATK_MODE` | `live` (varsayılan, gerçek ATK verisi) veya `mock` (örnek veri) |
| `OKX_SITE` | `tr` (varsayılan) |
| `LIVE` | `true` olursa ve bakiye ≥ 1 USDT ise gerçek emir. İlk gerçek emri kullanıcı bilinçli açar. |
| `AUTONOMOUS` | Otonom mod başlangıç değeri (panelden de değişir) |
| `SCAN_INTERVAL_SEC` | Gözcü döngüsü aralığı (varsayılan 30) |
| `PAPER_BALANCE_USDT` | Kuru çalışmada başlangıç bakiyesi (varsayılan 30) |
| `OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE` | Yalnızca hesap ve emir araçları için; piyasa verisi anahtarsız çalışır |
| `MENTOR_PROVIDER` | `gemini` (varsayılan), `claude` veya `rule` |
| `MENTOR_MODEL` | Boşsa `gemini-3.8-flash` |
| `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Yapay zeka mentoru (Claude için varsayılan `claude-haiku-5-5`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID` | Telegram botu |

Sırlar yalnızca `.env`'dedir; ekrana, günlüğe, SSE'ye ve API yanıtlarına asla düşmez (maskeleme katmanı + testler). ATK alt sürecine yalnızca `PATH`, `HOME` ve OKX kimlikleri geçer.

## ATK yolu (Adım 0)

**Seçilen yol: (a) resmi `@okx_ai/okx-trade-mcp` stdio MCP sunucusu, `@modelcontextprotocol/sdk` istemcisiyle kendi Node sunucumuzun alt süreci olarak.**
Neden: paket npm'de mevcut, `--site tr` ve `OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE` ortam değişkenlerini destekliyor, piyasa araçları anahtarsız gerçek veri döndürüyor ve `--read-only` bayrağıyla emir araçları hiç yüklenmeden açılabiliyor; uzak OAuth (b) ve CLI (c) yollarına gerek kalmadı.

- Okuma doğrulaması: `npm run atk:probe` (ticker, mum, RSI göstergesi gerçek veri döndürür). Ayrıca Claude Code'daki `okx-agent-trade-kit` bağlantısıyla `market_get_ticker` salt okuma olarak doğrulandı.
- Kuru modda ATK sunucusu `--read-only` ile başlar: emir araçları sunucuda bile yoktur. `LIVE=true` iken `--live` ve `spot`/`account` modülleri yüklenir.
- Her ATK çağrısı `SignalLedger`'a yazılır (araç, parametre özeti, sonuç özeti, süre, zaman) ve panelde **ATK çağrıları** kartında sayaç + araç listesi + son çağrılar olarak görünür.
- `news_*` ve `smartmoney_*` modülleri OKX OAuth kimliği istiyor; anahtarsız ortamda nazikçe devre dışı kalır (duygu nötr kabul edilir, uydurulmaz).
- ATK'ya ulaşılamazsa `ResilientMarketData` örnek veriye düşer ve arayüzde "canlı veri yok" gösterilir; arayüz (port) aynı kalır.

Kullanılan ATK araçları: `market_get_tickers`, `market_get_candles`, `market_get_indicator` (RSI), `market_get_funding_rate`, `market_get_orderbook` (makas/derinlik), `market_get_instruments` (lot büyüklüğü), `news_get_coin_sentiment` (kimlik varsa), `account_get_balance`, `spot_place_order` (bağlı stop/hedefle), `spot_place_algo_order` (OCO), `spot_cancel_algo_order`, `spot_get_order`, `spot_get_algo_orders`.

## Mimari

```
Gözcü döngüsü (30 sn) ─ Tara → Güvenlik → Karar → Sözleşme kontrolü → Emir → İz
       │                  ATK      emir defteri   skor+fiyatlar  uyarı (kilit yok)   sert limit kapısı   sha256 zincir
       ▼
 Express + SSE ── 7 sayfa (vanilla JS) · Mentor (Gemini → Claude → kural) · Telegram (long polling)
```

Portlar (`src/ports.ts`) ve uygulamaları:

| Port | Gerçek | Örnek / yedek |
|---|---|---|
| `MarketData` | `AtkMarketData` (stdio MCP) | `MockMarketData`, `ResilientMarketData` (otomatik düşüş) |
| `TradingClient` | `AtkTradingClient` (`LIVE=true`) | `MockTradingClient` (KURU) — kapı ikisinde de aynı |
| `DecisionProvider` | `RuleDecisionProvider` (`config/thresholds.json`) | — |
| `Notifier` | `TelegramBot` | `MockNotifier` / önizleme |
| `SignalLedger` | sha256 zincirli bellek içi kayıt | — |
| `MentorProvider` | `GeminiMentor`, `ClaudeMentor` | `RuleMentor` |
| `ProofAnchor` | (sonraki dilim: Avalanche Fuji) | `NoopProofAnchor` |

## Sert limitler (kodda, koşulsuz)

`config/hardlimits.json` yalnızca **sıkılaştırabilir**; koddaki tavanların üstündeki değerler yok sayılır (`src/trading/hardLimits.ts`). Kapı `TradingClient` içindedir ve pop-up, mentor, Telegram ya da ayar ile aşılamaz.

- Tek emir ≤ 5 USDT · toplam açık ≤ 15 USDT · en fazla 3 açık pozisyon · saatte en fazla 6 emir
- Yalnızca spot, yalnızca izin listesindeki 28 likit USDT çifti; her girişte stop zorunlu
- Çekim, transfer, earn, bot, event, swap/futures/option araçları çağrılamaz: araç izin listesinde değilse `ToolNotAllowedError`
- Zarar sonrası hiçbir dondurma, durdurma ya da bekleme yoktur. Günlük zarar 5 USDT'yi geçerse yalnızca uyarı (pop-up, Telegram'a tek kısa mesaj, risk skoru artar); ajan ve kullanıcı çalışmaya devam eder
- Gerçek emir yalnızca `LIVE=true` ve bakiye ≥ 1 USDT iken

**Davranış sözleşmesi** (`config/contract.json`, sert limitlerden sıkı): en az R:R 1.5, stop en fazla %6, işlem riski bütçe içinde, risk skoru < 70, makas ≤ %0.25. Ajanın kararı aykırıysa ajan emri göndermez ve uyarı penceresi açılır: *"Ajan şu emri sözleşmeye aykırı buldu ve vermedi: …"*. Pencerenin tek düğmesi **Tamam**'dır (Esc de kapatır); aynı uyarı 60 sn içinde tekrar çıkmaz. Diğer tetikleyiciler: günlük zarar / risk skoru eşiği, 15 coin listeye alma, sert limite yaklaşma.

## Sayfa haritası

| Yol | İçerik |
|---|---|
| `/` | Karşılama: logo, dönüşümlü disiplin cümleleri, "Mentor ile görüş", "Kullanıcı paneline geç", canlı fiyat dokusu |
| `/kesfet` | Tinder mantığında aday kartları: sürükle / ← → / düğmeler, geri al (Backspace), sağa = takibe al + mentor analizi, liste görünümü, "Mentorla planla" (plan ajana tercih olarak iletilir) |
| `/mentor` | Amber nabız halkası, HAZIR/DİNLİYOR/DÜŞÜNÜYOR/KONUŞUYOR, Web Speech `tr-TR`, cümle cümle okuma, Sustur, sesli sohbet, onay düğmeleri, Telegram ile ortak geçmiş |
| `/panel` | Değer çizgisi, pozisyonlar ve K/Z, davranış sözleşmesi (uyarı ve engellenen emir sayısı, limit çubukları, risk skoru), işlem geçmişi, olay günlüğü, ajan durumu ve anahtarlar, ATK çağrı günlüğü, risk bütçesi, iz kaydı, **Senaryoyu başlat** |
| `/isi-haritasi` | 28 coinlik treemap (boyut hacim, renk değişim veya fırsat/risk), kategori grupları, ipucu; ayrıntı çekmecesi (salt okunur ajan görüşü, giriş/stop/hedef çizgili grafik, skor bileşenleri, pozisyon, Takibe al, Ajana öncelik ver, Mentora sor). `?s=SOL-USDT` paylaşılabilir |
| `/telegram` | Bot tanıtımı, bağlantı durumu (jeton görünmez), 4 adım rehber, telefon çerçevesinde canlı önizleme, bildirim ayarları |
| `/hakkimizda` | Vizyon, nasıl çalışır, ekip (yer tutucu), yol haritası, MIT, sorumluluk notu, ATK araçları |

## Telegram kurulumu

1. BotFather ile bot oluşturun, jetonu `.env` → `TELEGRAM_BOT_TOKEN`.
2. Sunucuyu başlatıp bota `/id` yazın (izinli kullanıcı henüz yoksa yalnızca bu komut cevaplanır); sayıyı `TELEGRAM_ALLOWED_USER_ID` satırına yazın.
3. Sunucuyu yeniden başlatın. Bot yalnızca bu kimliğe cevap verir; başlangıçta bekleyen eski mesajları atlar.
4. Komutlar: `/kesfet` (kalp = takibe al, kırık kalp = geç), `/takip`, `/birak SOL`, `/durum`, `/portfoy`, `/bildirim`, `/sessiz 60`, `/ozet`, `/id`, `/yardim`. Komut olmayan her mesaj mentora gider.

Bildirim politikası: bot kendiliğinden aday yağdırmaz. Yalnızca takip edilen ya da elde tutulan coinler için anlamlı gelişme (15 dk'da 2×ATR üstü hareket, karar değişimi, güvenlik kötüleşmesi, risk artışı, stop/hedefe yaklaşma, pozisyon açılış/kapanış, daha iyi giriş) — coin başına 30 dk'da 1, saatte en fazla 6, aynı içerik tekrar yok; sohbet; kritik durumlar (stop/hedef, günlük zarar). Mesaj altında en fazla iki düğme (Analiz, Takibi bırak). Fırsat özeti varsayılan kapalı.

## Demo akışı (10 dk sunum)

1. **Karşılama** → "Kullanıcı paneline geç": ajan çalışıyor, canlı OKX verisi, ATK çağrı sayacı artıyor.
2. **Keşfet**: kartları kaydır; sağa kaydırınca mentor analizi (giriş/stop/hedef, R:R, örnek boyut). Listem → "Mentorla planla" → "Ajana tercih olarak ilet".
3. **Panel** → "Senaryoyu başlat": ajan tarar → karar verir → KURU emir verir → sözleşmeye aykırı ikinci karar engellenir ve uyarı penceresi açılır → bildirim.
4. **Telegram**: `/kesfet` kalp/kırık kalp; takip edilen coinde pozisyon bildirimi.
5. **Isı haritası**: coine bas → çekmece, ajanın görüşü, "Ajana öncelik ver".
6. **Mentor**: mikrofonla "SOL analizi", "BTC al" (nazik ret), "risk bütçesini %1.5 yap" (onay).

## Gerçek mi, örnek mi?

| Alan | Kaynak |
|---|---|
| Fiyat, 24 sa değişim, hacim, mumlar, RSI, funding, emir defteri makası/derinliği | **Gerçek** (ATK) |
| Skorlar, kararlar, giriş/stop/hedef, boyut | **Gerçek veriden kodla hesaplanır** |
| Haber duygusu | Gerçek (OKX OAuth kimliği varsa), yoksa nötr |
| Güvenlik özeti (denetim, arz açılışı, yoğunlaşma) | **ÖRNEK VERİ** (etiketli); yalnızca makas/derinlik gerçek |
| Emirler ve K/Z | `LIVE=false`: KURU (canlı fiyatla simülasyon) · `LIVE=true`: gerçek ATK emri |
| `ATK_MODE=mock` | Tüm piyasa verisi deterministik örnek veri |

## Testler

```bash
npm run typecheck
npm test            # node:test birim testleri
npm run test:e2e    # Playwright (bilgisayardaki Microsoft Edge ile; PW_CHANNEL=chromium da olur)
```

Birim testleri: sert limit kapısı (aşan emir, izin dışı araç, stopsuz emir, kuru mod, zarardan sonra emirlerin hâlâ geçmesi), skorlama, uyarı merkezi (kilit yok, 60 sn tekrar yok), boyutlandırma/plan, bildirim politikası, mentor araç döngüsü (sahte `fetch`, ≤ 4 tur), enjeksiyon dayanıklılığı, Telegram (sahte `fetch`, 429, 4096), anahtarların hiçbir çıktıda geçmemesi, `.env` yokken çökmeme, kullanıcı emir uç noktasının olmaması.
Playwright: tüm sayfalar 200, 360/1440 px ekran görüntüsü ve yatay taşma kontrolü (`artifacts/screens/`), kaydırma/sürükleme/tuş akışı, 15 coin uyarısı, pop-up odak/Esc, ısı haritası → çekmece → URL, kullanıcı emir yolu yok, panelde kaydırmanın korunması, konsol hatası yok.

## Varsayımlar

- "Saatte en fazla 6 emir" yeni girişlere (yeni risk) uygulanır; stop, hedef ve kısmi kâr çıkışları risk azalttığı için bu sayaca takılmaz (bir stop asla engellenmemeli).
- Gerçek modda girişte borsaya bağlı stop/hedef konur (sert koruma); breakeven, iz süren stop ve kısmi kâr ajan tarafından yönetilir. Kısmi çıkış veya stop taşıma sonrası kalan miktar için OCO yeniden kurulur.
- Günlük K/Z = bugünkü (UTC) gerçekleşen + açık pozisyonların gerçekleşmemiş K/Z'si.
- Kuru çalışma bakiyesi 30 USDT (organizatörün yüklediği tutar), komisyon %0.1 varsayılır.
- Karar eşikleri (`config/thresholds.json`) kural kitabı gelene kadar makul varsayılanlardır; 15 dakikalık mumlara göre ayarlıdır.
- Gemini modeli: resmi model sayfasına göre en güncel kararlı, ücretsiz katmanlı flash modeli `gemini-3.8-flash`; düşünme ayarı `low` (reddedilirse alansız yeniden denenir).
- Durum bellektedir; sunucu yeniden başlarsa kuru pozisyonlar, takip listesi ve sohbet sıfırlanır.
- Git'te `user.name` tanımlı olmadığı için commit'ler depo içinde `yy04` adıyla atıldı.

## Bilinen eksikler

- Avalanche `ProofAnchor` ve web yayını sonraki dilimde (arayüz hazır, şu an no-op).
- Haber duygusu ve smartmoney sinyalleri OKX OAuth kimliği olmadan kapalı.
- Gerçek emir yolu kodlandı ve birim testlerle kapı/izin listesi doğrulandı, ancak geliştirme sırasında `LIVE=true` hiç açılmadı (bilinçli olarak).

## Lisans

MIT — bkz. `LICENSE`.
