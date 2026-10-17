# GÜNCELLEME 2 – Checklist

Durum: `[ ]` yapılmadı · `[x] DONE` çalıştırılıp doğrulandı · `[~] PARTIAL` · `[!] BLOCKED` (neden yazılı).
Başlangıç: 15:01 · Kod dondurma: 18:30 · Teslim: 19:00

## Protokol
- [x] DONE P1 Checklist dosyası oluşturuldu (bu dosya)
- [ ] P2 Maddeler sırayla 1→9; her madde: kod → test (`npm test`, `npm run typecheck`) → Playwright ekran görüntüsü 360/1440 → commit "Güncelleme2 madde N: ..."
- [ ] P3 Yapılamayan kalem BLOCKED + tek cümle neden + en yakın alternatif
- [x] DONE P4 Harici uç noktalar curl ile doğrulandı → `docs/VERI_KAYNAKLARI.md` (OKX public, Binance Futures, CoinGecko, DefiLlama, Honeypot.is, OnchainOS); izin listesine eklendi
- [ ] P5 Mevcut kurallar korunuyor (sert limitler, LIVE=false varsayılan, anahtarlar yalnızca .env, yasak terimler, tavsiye yok, dondurma yok)
- [ ] P5a QUICK_COMMANDS varsayılanı: LIVE=false iken açık; LIVE=true iken varsayılan kapalı, yalnızca .env'de açıkça true ise çalışır
- [ ] P5b Isı haritası/çekmecede Al/Sat düğmesi yok
- [!] BLOCKED P6 Follow Line (lisans başlığı ve kaynak kod sayfadan doğrulanamadı; kendi ATR trend çizgimiz kullanılıyor, arayüzde "Follow Line" adı yok) – lisans başlığı kontrol edildi; izin yoksa BLOCKED + kendi ATR-trend çizgisi, "Follow Line" adı kullanılmaz; izin varsa dosya başı link/yazar/lisans notu
- [x] DONE P6a Lightweight Charts (TradingView) atfı korunuyor
- [ ] P7 Mentor kısa cevap kuralı (önceki işte yapıldı; doğrula: cevap_modu etiketi, few-shot, 220/800 token, sıcaklık 0.3, web+Telegram Ayrıntı düğmesi, aday analizi kısa)
- [ ] P8 17:00'de madde 9 başlamadıysa kapsam küçültme (tema + basit Terminal) ve buraya not
- [ ] P9 Durum raporları: madde 2, 4, 6, 8 sonrası
- [ ] P10 Bitiş tablosu (DONE/PARTIAL/BLOCKED + kanıt) ve elle deneme listesi

## Madde 1 – Terimler
- [x] DONE 1.1 Kategori adları İngilizce: Layer 1, Layer 2, DeFi, Meme, AI, RWA, Payment, Infrastructure, Gaming
- [x] DONE 1.2 "Katman 1/2", "Ödeme", "Yapay zeka" çevirileri her yerden kaldırıldı (watchlist, UI, README, testler)
- [x] DONE 1.3 funding, long/short, open interest, stop, R:R, PnL, FDV İngilizce kalır (K/Z → PnL)
- [x] DONE 1.4 "KURU" / "KURU ÇALIŞMA" → "PAPER" / "Paper trade" (UI, loglar, Telegram, ledger, README)
- [x] DONE 1.5 Açıklama balonu: "Gerçek piyasa verisi, sanal bakiye; emir borsaya gitmez."
- [x] DONE 1.6 Test + ekran görüntüsü + commit

## Madde 2 – Grafik çekmecesi
- [x] DONE 2.1 Açılınca varsayılan: grafik + yanında "AI analizi" kartı (ajanın görüşü, gerekçe, vadeli özeti, hold/arz özeti)
- [x] DONE 2.2 Giriş/stop/hedef çizgileri varsayılan KAPALI
- [!] BLOCKED 2.3 (Follow Line lisansı doğrulanamadı; yerine "Trend çizgisi · TimosAI ATR" düğmesi, kanıt: e2e "madde 2") Grafik üstünde "Follow Line · Kıvanç Özbilgiç" düğmesi (lisans uygunsa; değilse BLOCKED + kendi çizgimiz farklı adla)
- [x] DONE 2.4 Çizgi mavi/kırmızı, yön dönüş marker'ları
- [~] PARTIAL 2.5 (lejantta ad + yazar (TimosAI) + açıklama var; Follow Line script linki BLOCKED nedeniyle yok) Lejant: ad + yazar + kısa açıklama + script linki
- [x] DONE 2.6 "Seviyeler" düğmesi: giriş/stop/hedef çizgileri aç/kapa
- [x] DONE 2.7 Fiyat formatı coinin tickSz'ine göre (düşük fiyatlılarda etiket çakışması yok)
- [x] DONE 2.8 Test + ekran görüntüsü + commit

## Madde 3 – Canlı inceleme hataları
- [x] DONE 3.1 Hold raporu hacim kuralı skor motorundaki hacim ölçüsüyle aynı fonksiyon ve eşik
- [x] DONE 3.2 Keşfet "Yön" etiketine zaman aralığı ("1s trend: yukarı")
- [x] DONE 3.3 24 sa değişim yön etiketinin yanında
- [x] DONE 3.4 Her taramada izleme listesi için news_get_coin_sentiment ve son haberler çağrılır
- [~] PARTIAL 3.5 (bağlantı kodda hazır ve testli; OKX news OAuth istediği için canlı veri yok, "veri yok" gösteriliyor) Sonuç "Haber duygusu" skoruna ve haber bildirimlerine yansır
- [x] DONE 3.6 Veri yoksa "veri yok" (50 değil)
- [x] DONE 3.7 Test + ekran görüntüsü + commit

## Madde 4 – Paper trading motoru
- [ ] 4.1 Sanal bakiye config, varsayılan 1000 USDT
- [ ] 4.2 Panelden sıfırlama
- [ ] 4.3 Market emir: order book en iyi ask/bid + komisyon (config) + slipaj (config)
- [ ] 4.4 Stop/hedef canlı fiyatla tetiklenir
- [ ] 4.5 Paper futures: /l, /s ve ajanın vadeli kararları global SWAP fiyatıyla
- [ ] 4.6 Isolated margin, likidasyon fiyatı, funding etkisi 8 saatte bir
- [ ] 4.7 Kaldıraç tavanı config
- [ ] 4.8 Panelde istatistik kartı: kazanma oranı, ortalama R, maks drawdown, toplam PnL, işlem sayısı
- [ ] 4.9 Canlı mod: LIVE=true + OKX anahtarı → yalnızca spot, sert limitler
- [ ] 4.10 Canlı işlemler "CANLI" etiketi + OKX emir numarası
- [ ] 4.11 Bonus: gün içinde tek küçük canlı spot işlem (kullanıcı anahtar girip LIVE=true yaptığında)
- [ ] 4.12 QUICK_COMMANDS=true (paper'da varsayılan)
- [ ] 4.13 İşlem geçmişi etiketleri PAPER / CANLI × OTONOM / HIZLI
- [ ] 4.14 Test + ekran görüntüsü + commit

## Madde 5 – Keşfet CEX / DEX
- [ ] 5.1 Keşfet üstünde iki sekme: CEX ve DEX; kart kuyruğu CEX altında
- [ ] 5.2 CEX arama kutusu, yazdıkça öneri (sembol + ad)
- [ ] 5.3 Öneri listesi klavyeyle gezilebilir; "/" aramaya odaklar
- [ ] 5.4 Kaynak OKX spot enstrüman listesi (ATK), 1 saat önbellek, sabit liste yok
- [ ] 5.5 Pariteler USDT + USDC, BTC, ETH, SOL, TRY (yalnızca borsada olanlar)
- [ ] 5.6 Coin seçilince parite sekmeleri
- [ ] 5.7 Sonuç satırı: sembol, parite, son fiyat, 24 sa değişim, 24 sa hacim (kote + USDT karşılığı)
- [ ] 5.8 Seçilince görünüm: büyük grafik (15m/1H/4H/1D, Follow Line düğmesi), AI analizi, vadeli (yalnızca SWAP varsa), arz dedektörü, Takibe al, Ajana öncelik ver, Mentora sor
- [ ] 5.9 Düşük hacimli paritede "likidite düşük" uyarısı
- [ ] 5.10 İzin listesi değişmez; diğer paritelerde "analiz için; işlem izin listesinde değil"
- [ ] 5.11 DEX: zincir seçici + CA kutusu; EVM 0x+40 hex, Solana base58 doğrulama
- [ ] 5.12 DEX ad araması (OnchainOS token arama) + uyarı "Aynı isimli sahte tokenlar olabilir; kontrat adresini doğrula."
- [ ] 5.13 DEX seçilince: token bilgisi (OnchainOS: fiyat, piyasa değeri, likidite, holder, dağılım), varsa grafik, güvenlik tablosu
- [ ] 5.14 URL: /kesfet?tab=cex&s=AVAX-USDC ve /kesfet?tab=dex&chain=43114&ca=0x...
- [ ] 5.15 Telegram /coin AVAX, /coin AVAX BTC
- [ ] 5.16 Telegram /tara <zincir> <CA>
- [ ] 5.17 Test + ekran görüntüsü + commit

## Madde 6 – Güvenlik taraması tablosu
- [ ] 6.1 DEX sekmesinde token seçilince açılır; Pro'da Terminal içinde panel
- [ ] 6.2 Sütun GoPlus
- [ ] 6.3 Sütun Honeypot.is (desteklenmeyen zincirde "desteklenmiyor")
- [ ] 6.4 Sütun OKX OnchainOS
- [ ] 6.5 Sütun Timos simülasyonu (anvil yoksa gizli)
- [ ] 6.6 Logo yok; kaynak adı metin + kendi sade SVG ikonumuz
- [ ] 6.7 Satırlar: Kontrat doğrulanmış, Honeypot, Alım vergisi, Satış vergisi, Proxy, Mintable, Vergi değiştirilebilir, Blacklist, Transfer durdurulabilir, Gizli/geri alınabilir sahiplik, Sahip bakiye değiştirebilir, LP kilitli/yakılmış, Holder sayısı / ilk 10 payı (etiketli)
- [ ] 6.8 Hücre: değer + durum noktası (yeşil/sarı/kırmızı/gri) + metin; alan yoksa "–"
- [ ] 6.9 Özet pill'leri Tehlike/Uyarı/Nötr (n), tıklanınca filtre
- [ ] 6.10 Karar rozeti PASS/WARN/BLOCK
- [ ] 6.11 Her satırda (i) "neden önemli"
- [ ] 6.12 Çelişkide sarı kenarlık + "Kaynaklar çelişiyor"
- [ ] 6.13 En sağda "Timos kararı" sütunu (oylama kuralları)
- [ ] 6.14 Satıra tıklayınca ham değerler (Pro'da varsayılan açık)
- [ ] 6.15 Demo düğmeleri: 1 temiz + 1 doğrulanmış honeypot (Honeypot.is destekli zincir)
- [ ] 6.16 Sonuç SignalLedger'a; Telegram /tara metin tablo
- [ ] 6.17 Test + ekran görüntüsü + commit

## Madde 7 – Arz dedektörü
- [ ] 7.1 Görünür: Keşfet CEX görünümü, Isı haritası çekmecesi, Pro Terminal, Telegram /arz
- [ ] 7.2 Arz yapısı: max/total/circulating, dolaşım %, FDV/MC, Sınırlı/Sınırsız arz rozeti
- [ ] 7.3 Arz değişimi 1G/1A/1Y (market_chart, MC/fiyat), yıllık enflasyon, "tahmini (MC/fiyat)" etiketi
- [ ] 7.4 Arz azalıyorsa "deflasyonist (yakım)"
- [ ] 7.5 Günlük > %1 sıçrama olay olarak işaretli (+ tanım değişikliği notu)
- [ ] 7.6 Kilit açılımı: önce DefiLlama; yoksa config/unlocks.json (ÖRNEK VERİ)
- [ ] 7.7 Sonraki açılım tarihi, miktar, dolaşıma oranı, 30/90 gün toplam
- [ ] 7.8 Arz baskısı skoru düşük/orta/yüksek + gerekçe; hold raporu kullanır
- [ ] 7.9 1 yıllık arz eğrisi grafiği + açılım tarihleri işaretli
- [ ] 7.10 Önbellek 1 saat; rate limit → "veri yok"
- [ ] 7.11 Takipteki coinde 7 gün içinde açılım → bildirim
- [ ] 7.12 Test + ekran görüntüsü + commit

## Madde 8 – Long/Short tablosu
- [ ] 8.1 OKX top trader L/S (hesap + pozisyon)
- [ ] 8.2 Binance topLongShortAccountRatio / topLongShortPositionRatio / globalLongShortAccountRatio (5m), curl ile doğrulandı
- [ ] 8.3 Sütunlarda kaynak etiketi; "top trader" tanım farkı açıklama balonunda
- [ ] 8.4 Long yüzdesi = oran / (1 + oran)
- [ ] 8.5 Coin bazında görünüm
- [ ] 8.6 Özet satırları: BTC, ETH, Top 10, Top 20, All, Ex Top 20
- [ ] 8.7 Kategori bazında, 24 sa USDT hacmiyle ağırlıklı
- [ ] 8.8 Güncelleme zamanı görünür
- [ ] 8.9 Vadeli durum kartı bu verileri kullanır (hesap vs pozisyon ayrışması)
- [ ] 8.10 Telegram /ls monospace tablo, /ls SOL tek coin
- [ ] 8.11 Kategori long oranı eşiği (%75/%25, config) aşınca tek bildirim
- [ ] 8.12 Test + ekran görüntüsü + commit

## Madde 9 – Basic / Pro + gündüz/gece
- [ ] 9.1 Basic mevcut tasarım korunur
- [ ] 9.2 Pro "Terminal" düzeni: solda izleme listesi (fiyat, 24 sa, funding, long%)
- [ ] 9.3 Ortada büyük grafik (Follow Line, hacim, zaman aralığı)
- [ ] 9.4 Sağda order book derinliği + vadeli kartı + L/S + arz özeti
- [ ] 9.5 Altta sekmeler: pozisyonlar, emir geçmişi, paper istatistikleri, güvenlik taraması, ATK günlüğü
- [ ] 9.6 Pro renk dili: soğuk lacivert, yeşil/kırmızı PnL, amber yok, tabular-nums
- [ ] 9.7 Geçiş View Transitions API; reduced-motion'da animasyon yok
- [ ] 9.8 Gündüz/gece her iki sürümde; 4 palet; localStorage (try/catch); varsayılan sistem teması; AA kontrast
- [ ] 9.9 Test + ekran görüntüsü + commit

## Güvenlik hatırlatması
- [ ] G1 Tünel açıkken LIVE=false
- [ ] G2 LIVE=true öncesi tünel kapatılır (README + kullanıcıya not)
- [ ] G3 Panelde anahtar/token görünmez

## Son kontrol
- [ ] S1 Belge baştan sona yeniden okundu, eşleşmeyen cümle yok
- [ ] S2 npm test, npm run typecheck, Playwright duman testi sonuçları raporda
