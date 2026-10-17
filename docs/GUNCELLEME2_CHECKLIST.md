# GÜNCELLEME 2 – Checklist

Durum: `[ ]` yapılmadı · `[x] DONE` çalıştırılıp doğrulandı · `[~] PARTIAL` · `[!] BLOCKED` (neden yazılı).
Başlangıç: 15:01 · Kod dondurma: 18:30 · Teslim: 19:00

## Protokol
- [x] DONE P1 Checklist dosyası oluşturuldu (bu dosya)
- [x] DONE P2 Maddeler sırayla 1→9; her madde: kod → test (`npm test`, `npm run typecheck`) → Playwright ekran görüntüsü 360/1440 → commit "Güncelleme2 madde N: ..."
- [x] DONE P3 Yapılamayan kalem BLOCKED + tek cümle neden + en yakın alternatif
- [x] DONE P4 Harici uç noktalar curl ile doğrulandı → `docs/VERI_KAYNAKLARI.md` (OKX public, Binance Futures, CoinGecko, DefiLlama, Honeypot.is, OnchainOS); izin listesine eklendi
- [x] DONE P5 Mevcut kurallar korunuyor (sert limitler, LIVE=false varsayılan, anahtarlar yalnızca .env, yasak terimler, tavsiye yok, dondurma yok)
- [x] DONE P5a QUICK_COMMANDS varsayılanı: LIVE=false iken açık; LIVE=true iken varsayılan kapalı, yalnızca .env'de açıkça true ise çalışır
- [x] DONE P5b Isı haritası/çekmecede Al/Sat düğmesi yok
- [!] BLOCKED P6 Follow Line (lisans başlığı ve kaynak kod sayfadan doğrulanamadı; kendi ATR trend çizgimiz kullanılıyor, arayüzde "Follow Line" adı yok) – lisans başlığı kontrol edildi; izin yoksa BLOCKED + kendi ATR-trend çizgisi, "Follow Line" adı kullanılmaz; izin varsa dosya başı link/yazar/lisans notu
- [x] DONE P6a Lightweight Charts (TradingView) atfı korunuyor
- [x] DONE P7 Mentor kısa cevap kuralı (önceki işte yapıldı; doğrula: cevap_modu etiketi, few-shot, 220/800 token, sıcaklık 0.3, web+Telegram Ayrıntı düğmesi, aday analizi kısa)
- [x] DONE P8 (madde 9 saat 15:35'te başladı; kapsam küçültülmedi, tam uygulandı) 17:00'de madde 9 başlamadıysa kapsam küçültme (tema + basit Terminal) ve buraya not
- [x] DONE P9 Durum raporları: madde 2, 4, 6, 8 sonrası
- [x] DONE P10 Bitiş tablosu (DONE/PARTIAL/BLOCKED + kanıt) ve elle deneme listesi

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
- [x] DONE 4.1 Sanal bakiye config, varsayılan 1000 USDT
- [x] DONE 4.2 Panelden sıfırlama
- [x] DONE 4.3 Market emir: order book en iyi ask/bid + komisyon (config) + slipaj (config)
- [x] DONE 4.4 Stop/hedef canlı fiyatla tetiklenir
- [x] DONE 4.5 Paper futures: /l, /s ve ajanın vadeli kararları global SWAP fiyatıyla
- [x] DONE 4.6 Isolated margin, likidasyon fiyatı, funding etkisi 8 saatte bir
- [x] DONE 4.7 Kaldıraç tavanı config
- [x] DONE 4.8 Panelde istatistik kartı: kazanma oranı, ortalama R, maks drawdown, toplam PnL, işlem sayısı
- [x] DONE 4.9 Canlı mod: LIVE=true + OKX anahtarı → yalnızca spot, sert limitler
- [~] PARTIAL 4.10 (CANLI etiketi + OKX emir numarası kodda ve panelde hazır; canlı işlem henüz yapılmadı) Canlı işlemler "CANLI" etiketi + OKX emir numarası
- [!] BLOCKED 4.11 (OKX API anahtarları .env'de boş ve LIVE=true kararı kullanıcıya ait; anahtar girilip tünel kapatıldıktan sonra yapılacak) Bonus: gün içinde tek küçük canlı spot işlem (kullanıcı anahtar girip LIVE=true yaptığında)
- [x] DONE 4.12 QUICK_COMMANDS=true (paper'da varsayılan)
- [x] DONE 4.13 İşlem geçmişi etiketleri PAPER / CANLI × OTONOM / HIZLI
- [x] DONE 4.14 Test + ekran görüntüsü + commit

## Madde 5 – Keşfet CEX / DEX
- [x] DONE 5.1 Keşfet üstünde iki sekme: CEX ve DEX; kart kuyruğu CEX altında
- [x] DONE 5.2 CEX arama kutusu, yazdıkça öneri (sembol + ad)
- [x] DONE 5.3 Öneri listesi klavyeyle gezilebilir; "/" aramaya odaklar
- [x] DONE 5.4 Kaynak OKX spot enstrüman listesi (ATK), 1 saat önbellek, sabit liste yok
- [x] DONE 5.5 (OKX'te AVAX-BTC yok; yalnızca borsada olanlar listeleniyor: AVAX-USDT/USDC/TRY, canlı doğrulandı) Pariteler USDT + USDC, BTC, ETH, SOL, TRY (yalnızca borsada olanlar)
- [x] DONE 5.6 Coin seçilince parite sekmeleri
- [x] DONE 5.7 Sonuç satırı: sembol, parite, son fiyat, 24 sa değişim, 24 sa hacim (kote + USDT karşılığı)
- [x] DONE 5.8 Seçilince görünüm: büyük grafik (15m/1H/4H/1D, Follow Line düğmesi), AI analizi, vadeli (yalnızca SWAP varsa), arz dedektörü, Takibe al, Ajana öncelik ver, Mentora sor
- [x] DONE 5.9 Düşük hacimli paritede "likidite düşük" uyarısı
- [x] DONE 5.10 İzin listesi değişmez; diğer paritelerde "analiz için; işlem izin listesinde değil"
- [x] DONE 5.11 DEX: zincir seçici + CA kutusu; EVM 0x+40 hex, Solana base58 doğrulama
- [~] PARTIAL 5.12 (uyarı metni gösteriliyor; OnchainOS token araması Web3 anahtarı/x402 istediği için BLOCKED, kontrat adresiyle arama çalışıyor) DEX ad araması (OnchainOS token arama) + uyarı "Aynı isimli sahte tokenlar olabilir; kontrat adresini doğrula."
- [~] PARTIAL 5.13 (güvenlik tablosu madde 6'da GoPlus + Honeypot.is ile; OnchainOS token bilgisi (fiyat/MC/likidite/holder dağılımı) anahtar gerektirdiği için BLOCKED; DEX grafiği yok) DEX seçilince: token bilgisi (OnchainOS: fiyat, piyasa değeri, likidite, holder, dağılım), varsa grafik, güvenlik tablosu
- [x] DONE 5.14 URL: /kesfet?tab=cex&s=AVAX-USDC ve /kesfet?tab=dex&chain=43114&ca=0x...
- [x] DONE 5.15 Telegram /coin AVAX, /coin AVAX BTC
- [x] DONE 5.16 Telegram /tara <zincir> <CA>
- [x] DONE 5.17 Test + ekran görüntüsü + commit

## Madde 6 – Güvenlik taraması tablosu
- [x] DONE 6.1 (DEX sekmesi + Terminal alt sekmesi "Güvenlik taraması") DEX sekmesinde token seçilince açılır; Pro'da Terminal içinde panel
- [x] DONE 6.2 Sütun GoPlus
- [x] DONE 6.3 Sütun Honeypot.is (desteklenmeyen zincirde "desteklenmiyor")
- [~] PARTIAL 6.4 (sütun var, "Web3 API anahtarı gerekli" ve tüm hücreler "–"; OnchainOS anahtar/x402 istediği için veri BLOCKED) Sütun OKX OnchainOS
- [x] DONE 6.5 (anvil bu ortamda yok → sütun gizli; karar mantığı simülasyonu destekliyor, test: "simülasyon çelişkide kazanır") Sütun Timos simülasyonu (anvil yoksa gizli)
- [x] DONE 6.6 Logo yok; kaynak adı metin + kendi sade SVG ikonumuz
- [x] DONE 6.7 Satırlar: Kontrat doğrulanmış, Honeypot, Alım vergisi, Satış vergisi, Proxy, Mintable, Vergi değiştirilebilir, Blacklist, Transfer durdurulabilir, Gizli/geri alınabilir sahiplik, Sahip bakiye değiştirebilir, LP kilitli/yakılmış, Holder sayısı / ilk 10 payı (etiketli)
- [x] DONE 6.8 Hücre: değer + durum noktası (yeşil/sarı/kırmızı/gri) + metin; alan yoksa "–"
- [x] DONE 6.9 Özet pill'leri Tehlike/Uyarı/Nötr (n), tıklanınca filtre
- [x] DONE 6.10 Karar rozeti PASS/WARN/BLOCK
- [x] DONE 6.11 Her satırda (i) "neden önemli"
- [x] DONE 6.12 Çelişkide sarı kenarlık + "Kaynaklar çelişiyor"
- [x] DONE 6.13 En sağda "Timos kararı" sütunu (oylama kuralları)
- [x] DONE 6.14 Satıra tıklayınca ham değerler (Pro'da varsayılan açık)
- [~] PARTIAL 6.15 (2 temiz demo: BSC USDT ve Avalanche USDC; doğrulanmış gerçek honeypot adresi bulunamadı, uydurulmadı → honeypot düğmesi BLOCKED) Demo düğmeleri: 1 temiz + 1 doğrulanmış honeypot (Honeypot.is destekli zincir)
- [x] DONE 6.16 Sonuç SignalLedger'a; Telegram /tara metin tablo
- [x] DONE 6.17 Test + ekran görüntüsü + commit

## Madde 7 – Arz dedektörü
- [x] DONE 7.1 (Keşfet CEX, ısı haritası çekmecesi, Terminal "Arz özeti", Telegram /arz) Görünür: Keşfet CEX görünümü, Isı haritası çekmecesi, Pro Terminal, Telegram /arz
- [x] DONE 7.2 Arz yapısı: max/total/circulating, dolaşım %, FDV/MC, Sınırlı/Sınırsız arz rozeti
- [x] DONE 7.3 Arz değişimi 1G/1A/1Y (market_chart, MC/fiyat), yıllık enflasyon, "tahmini (MC/fiyat)" etiketi
- [x] DONE 7.4 Arz azalıyorsa "deflasyonist (yakım)"
- [x] DONE 7.5 Günlük > %1 sıçrama olay olarak işaretli (+ tanım değişikliği notu)
- [~] PARTIAL 7.6 (DefiLlama emisyon API'si ücretli: HTTP 402 → config/unlocks.json ÖRNEK VERİ kullanılıyor) Kilit açılımı: önce DefiLlama; yoksa config/unlocks.json (ÖRNEK VERİ)
- [x] DONE 7.7 Sonraki açılım tarihi, miktar, dolaşıma oranı, 30/90 gün toplam
- [x] DONE 7.8 Arz baskısı skoru düşük/orta/yüksek + gerekçe; hold raporu kullanır
- [x] DONE 7.9 1 yıllık arz eğrisi grafiği + açılım tarihleri işaretli
- [x] DONE 7.10 Önbellek 1 saat; rate limit → "veri yok"
- [x] DONE 7.11 Takipteki coinde 7 gün içinde açılım → bildirim
- [x] DONE 7.12 Test + ekran görüntüsü + commit

## Madde 8 – Long/Short tablosu
- [x] DONE 8.1 OKX top trader L/S (hesap + pozisyon)
- [x] DONE 8.2 Binance topLongShortAccountRatio / topLongShortPositionRatio / globalLongShortAccountRatio (5m), curl ile doğrulandı
- [x] DONE 8.3 Sütunlarda kaynak etiketi; "top trader" tanım farkı açıklama balonunda
- [x] DONE 8.4 Long yüzdesi = oran / (1 + oran)
- [x] DONE 8.5 Coin bazında görünüm
- [x] DONE 8.6 Özet satırları: BTC, ETH, Top 10, Top 20, All, Ex Top 20
- [x] DONE 8.7 Kategori bazında, 24 sa USDT hacmiyle ağırlıklı
- [x] DONE 8.8 Güncelleme zamanı görünür
- [x] DONE 8.9 Vadeli durum kartı bu verileri kullanır (hesap vs pozisyon ayrışması)
- [x] DONE 8.10 Telegram /ls monospace tablo, /ls SOL tek coin
- [x] DONE 8.11 Kategori long oranı eşiği (%75/%25, config) aşınca tek bildirim
- [x] DONE 8.12 Test + ekran görüntüsü + commit

## Madde 9 – Basic / Pro + gündüz/gece
- [x] DONE 9.1 Basic mevcut tasarım korunur
- [x] DONE 9.2 Pro "Terminal" düzeni: solda izleme listesi (fiyat, 24 sa, funding, long%)
- [x] DONE 9.3 (Follow Line yerine "Trend çizgisi · TimosAI ATR" — P6 BLOCKED) Ortada büyük grafik (Follow Line, hacim, zaman aralığı)
- [x] DONE 9.4 Sağda order book derinliği + vadeli kartı + L/S + arz özeti
- [x] DONE 9.5 Altta sekmeler: pozisyonlar, emir geçmişi, paper istatistikleri, güvenlik taraması, ATK günlüğü
- [x] DONE 9.6 Pro renk dili: soğuk lacivert, yeşil/kırmızı PnL, amber yok, tabular-nums
- [x] DONE 9.7 Geçiş View Transitions API; reduced-motion'da animasyon yok
- [x] DONE 9.8 Gündüz/gece her iki sürümde; 4 palet; localStorage (try/catch); varsayılan sistem teması; AA kontrast
- [x] DONE 9.9 Test + ekran görüntüsü + commit

## Güvenlik hatırlatması
- [x] DONE G1 Tünel açıkken LIVE=false
- [x] DONE G2 (README "Güvenlik" notu; LIVE=true öncesi tünel kullanıcı tarafından kapatılmalı) LIVE=true öncesi tünel kapatılır (README + kullanıcıya not)
- [x] DONE G3 Panelde anahtar/token görünmez

## Son kontrol
- [x] DONE S1 Belge baştan sona yeniden okundu, eşleşmeyen cümle yok
- [x] DONE S2 npm test, npm run typecheck, Playwright duman testi sonuçları raporda


## Bitiş tablosu (17:xx öncesi, son kontrol sonrası)

Özet: DONE 109 · PARTIAL 8 · BLOCKED 3 · açık 0

| Kalem | Durum | Açıklama | Kanıt |
|---|---|---|---|
| P1 | DONE | Checklist dosyası oluşturuldu (bu dosya) | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P2 | DONE | Maddeler sırayla 1→9; her madde: kod → test (`npm test`, `npm run typecheck`) → Playwright ekran görüntüsü 360/1440 → commit "Güncelleme2 ma | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P3 | DONE | Yapılamayan kalem BLOCKED + tek cümle neden + en yakın alternatif | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P4 | DONE | Harici uç noktalar curl ile doğrulandı → `docs/VERI_KAYNAKLARI.md` (OKX public, Binance Futures, CoinGecko, DefiLlama, Honeypot.is, OnchainO | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P5 | DONE | Mevcut kurallar korunuyor (sert limitler, LIVE=false varsayılan, anahtarlar yalnızca .env, yasak terimler, tavsiye yok, dondurma yok) | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P5a | DONE | QUICK_COMMANDS varsayılanı: LIVE=false iken açık; LIVE=true iken varsayılan kapalı, yalnızca .env'de açıkça true ise çalışır | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P5b | DONE | Isı haritası/çekmecede Al/Sat düğmesi yok | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P6 | BLOCKED | Follow Line (lisans başlığı ve kaynak kod sayfadan doğrulanamadı; kendi ATR trend çizgimiz kullanılıyor, arayüzde "Follow Line" adı yok) – l | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P6a | DONE | Lightweight Charts (TradingView) atfı korunuyor | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P7 | DONE | Mentor kısa cevap kuralı (önceki işte yapıldı; doğrula: cevap_modu etiketi, few-shot, 220/800 token, sıcaklık 0.3, web+Telegram Ayrıntı düğm | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P8 | DONE | (madde 9 saat 15:35'te başladı; kapsam küçültülmedi, tam uygulandı) 17:00'de madde 9 başlamadıysa kapsam küçültme (tema + basit Terminal) ve | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P9 | DONE | Durum raporları: madde 2, 4, 6, 8 sonrası | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| P10 | DONE | Bitiş tablosu (DONE/PARTIAL/BLOCKED + kanıt) ve elle deneme listesi | süreç: 9 commit "Güncelleme2 madde N", durum raporları sohbette |
| 1.1 | DONE | Kategori adları İngilizce: Layer 1, Layer 2, DeFi, Meme, AI, RWA, Payment, Infrastructure, Gaming | npm test; e2e "tüm sayfalar"; artifacts/screens/360-isi-haritasi.png |
| 1.2 | DONE | "Katman 1/2", "Ödeme", "Yapay zeka" çevirileri her yerden kaldırıldı (watchlist, UI, README, testler) | npm test; e2e "tüm sayfalar"; artifacts/screens/360-isi-haritasi.png |
| 1.3 | DONE | funding, long/short, open interest, stop, R:R, PnL, FDV İngilizce kalır (K/Z → PnL) | npm test; e2e "tüm sayfalar"; artifacts/screens/360-isi-haritasi.png |
| 1.4 | DONE | "KURU" / "KURU ÇALIŞMA" → "PAPER" / "Paper trade" (UI, loglar, Telegram, ledger, README) | npm test; e2e "tüm sayfalar"; artifacts/screens/360-isi-haritasi.png |
| 1.5 | DONE | Açıklama balonu: "Gerçek piyasa verisi, sanal bakiye; emir borsaya gitmez." | npm test; e2e "tüm sayfalar"; artifacts/screens/360-isi-haritasi.png |
| 1.6 | DONE | Test + ekran görüntüsü + commit | npm test; e2e "tüm sayfalar"; artifacts/screens/360-isi-haritasi.png |
| 2.1 | DONE | Açılınca varsayılan: grafik + yanında "AI analizi" kartı (ajanın görüşü, gerekçe, vadeli özeti, hold/arz özeti) | e2e "Güncelleme2 madde 2"; unit "tickSz → ondalık"; artifacts/screens/g2-madde2-cekmece-{360,1440}.png |
| 2.2 | DONE | Giriş/stop/hedef çizgileri varsayılan KAPALI | e2e "Güncelleme2 madde 2"; unit "tickSz → ondalık"; artifacts/screens/g2-madde2-cekmece-{360,1440}.png |
| 2.3 | BLOCKED | (Follow Line lisansı doğrulanamadı; yerine "Trend çizgisi · TimosAI ATR" düğmesi, kanıt: e2e "madde 2") Grafik üstünde "Follow Line · Kıvanç | e2e "Güncelleme2 madde 2"; unit "tickSz → ondalık"; artifacts/screens/g2-madde2-cekmece-{360,1440}.png |
| 2.4 | DONE | Çizgi mavi/kırmızı, yön dönüş marker'ları | e2e "Güncelleme2 madde 2"; unit "tickSz → ondalık"; artifacts/screens/g2-madde2-cekmece-{360,1440}.png |
| 2.5 | PARTIAL | (lejantta ad + yazar (TimosAI) + açıklama var; Follow Line script linki BLOCKED nedeniyle yok) Lejant: ad + yazar + kısa açıklama + script l | e2e "Güncelleme2 madde 2"; unit "tickSz → ondalık"; artifacts/screens/g2-madde2-cekmece-{360,1440}.png |
| 2.6 | DONE | "Seviyeler" düğmesi: giriş/stop/hedef çizgileri aç/kapa | e2e "Güncelleme2 madde 2"; unit "tickSz → ondalık"; artifacts/screens/g2-madde2-cekmece-{360,1440}.png |
| 2.7 | DONE | Fiyat formatı coinin tickSz'ine göre (düşük fiyatlılarda etiket çakışması yok) | e2e "Güncelleme2 madde 2"; unit "tickSz → ondalık"; artifacts/screens/g2-madde2-cekmece-{360,1440}.png |
| 2.8 | DONE | Test + ekran görüntüsü + commit | e2e "Güncelleme2 madde 2"; unit "tickSz → ondalık"; artifacts/screens/g2-madde2-cekmece-{360,1440}.png |
| 3.1 | DONE | Hold raporu hacim kuralı skor motorundaki hacim ölçüsüyle aynı fonksiyon ve eşik | unit "madde 3" (agent, security, AtkMarketData); artifacts/screens/g2-madde3-kesfet-{360,1440}.png |
| 3.2 | DONE | Keşfet "Yön" etiketine zaman aralığı ("1s trend: yukarı") | unit "madde 3" (agent, security, AtkMarketData); artifacts/screens/g2-madde3-kesfet-{360,1440}.png |
| 3.3 | DONE | 24 sa değişim yön etiketinin yanında | unit "madde 3" (agent, security, AtkMarketData); artifacts/screens/g2-madde3-kesfet-{360,1440}.png |
| 3.4 | DONE | Her taramada izleme listesi için news_get_coin_sentiment ve son haberler çağrılır | unit "madde 3" (agent, security, AtkMarketData); artifacts/screens/g2-madde3-kesfet-{360,1440}.png |
| 3.5 | PARTIAL | (bağlantı kodda hazır ve testli; OKX news OAuth istediği için canlı veri yok, "veri yok" gösteriliyor) Sonuç "Haber duygusu" skoruna ve habe | unit "madde 3" (agent, security, AtkMarketData); artifacts/screens/g2-madde3-kesfet-{360,1440}.png |
| 3.6 | DONE | Veri yoksa "veri yok" (50 değil) | unit "madde 3" (agent, security, AtkMarketData); artifacts/screens/g2-madde3-kesfet-{360,1440}.png |
| 3.7 | DONE | Test + ekran görüntüsü + commit | unit "madde 3" (agent, security, AtkMarketData); artifacts/screens/g2-madde3-kesfet-{360,1440}.png |
| 4.1 | DONE | Sanal bakiye config, varsayılan 1000 USDT | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.2 | DONE | Panelden sıfırlama | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.3 | DONE | Market emir: order book en iyi ask/bid + komisyon (config) + slipaj (config) | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.4 | DONE | Stop/hedef canlı fiyatla tetiklenir | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.5 | DONE | Paper futures: /l, /s ve ajanın vadeli kararları global SWAP fiyatıyla | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.6 | DONE | Isolated margin, likidasyon fiyatı, funding etkisi 8 saatte bir | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.7 | DONE | Kaldıraç tavanı config | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.8 | DONE | Panelde istatistik kartı: kazanma oranı, ortalama R, maks drawdown, toplam PnL, işlem sayısı | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.9 | DONE | Canlı mod: LIVE=true + OKX anahtarı → yalnızca spot, sert limitler | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.10 | PARTIAL | (CANLI etiketi + OKX emir numarası kodda ve panelde hazır; canlı işlem henüz yapılmadı) Canlı işlemler "CANLI" etiketi + OKX emir numarası | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.11 | BLOCKED | (OKX API anahtarları .env'de boş ve LIVE=true kararı kullanıcıya ait; anahtar girilip tünel kapatıldıktan sonra yapılacak) Bonus: gün içinde | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.12 | DONE | QUICK_COMMANDS=true (paper'da varsayılan) | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.13 | DONE | İşlem geçmişi etiketleri PAPER / CANLI × OTONOM / HIZLI | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 4.14 | DONE | Test + ekran görüntüsü + commit | unit paper.test.ts; e2e "Güncelleme2 madde 4"; artifacts/screens/g2-madde4-panel-{360,1440}.png |
| 5.1 | DONE | Keşfet üstünde iki sekme: CEX ve DEX; kart kuyruğu CEX altında | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.2 | DONE | CEX arama kutusu, yazdıkça öneri (sembol + ad) | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.3 | DONE | Öneri listesi klavyeyle gezilebilir; "/" aramaya odaklar | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.4 | DONE | Kaynak OKX spot enstrüman listesi (ATK), 1 saat önbellek, sabit liste yok | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.5 | DONE | (OKX'te AVAX-BTC yok; yalnızca borsada olanlar listeleniyor: AVAX-USDT/USDC/TRY, canlı doğrulandı) Pariteler USDT + USDC, BTC, ETH, SOL, TRY | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.6 | DONE | Coin seçilince parite sekmeleri | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.7 | DONE | Sonuç satırı: sembol, parite, son fiyat, 24 sa değişim, 24 sa hacim (kote + USDT karşılığı) | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.8 | DONE | Seçilince görünüm: büyük grafik (15m/1H/4H/1D, Follow Line düğmesi), AI analizi, vadeli (yalnızca SWAP varsa), arz dedektörü, Takibe al, Aja | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.9 | DONE | Düşük hacimli paritede "likidite düşük" uyarısı | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.10 | DONE | İzin listesi değişmez; diğer paritelerde "analiz için; işlem izin listesinde değil" | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.11 | DONE | DEX: zincir seçici + CA kutusu; EVM 0x+40 hex, Solana base58 doğrulama | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.12 | PARTIAL | (uyarı metni gösteriliyor; OnchainOS token araması Web3 anahtarı/x402 istediği için BLOCKED, kontrat adresiyle arama çalışıyor) DEX ad arama | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.13 | PARTIAL | (güvenlik tablosu madde 6'da GoPlus + Honeypot.is ile; OnchainOS token bilgisi (fiyat/MC/likidite/holder dağılımı) anahtar gerektirdiği için | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.14 | DONE | URL: /kesfet?tab=cex&s=AVAX-USDC ve /kesfet?tab=dex&chain=43114&ca=0x... | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.15 | DONE | Telegram /coin AVAX, /coin AVAX BTC | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.16 | DONE | Telegram /tara <zincir> <CA> | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 5.17 | DONE | Test + ekran görüntüsü + commit | unit discover.test.ts; e2e "Güncelleme2 madde 5"; artifacts/screens/g2-madde5-{cex-360,cex-1440,dex-1440}.png |
| 6.1 | DONE | (DEX sekmesi + Terminal alt sekmesi "Güvenlik taraması") DEX sekmesinde token seçilince açılır; Pro'da Terminal içinde panel | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.2 | DONE | Sütun GoPlus | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.3 | DONE | Sütun Honeypot.is (desteklenmeyen zincirde "desteklenmiyor") | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.4 | PARTIAL | (sütun var, "Web3 API anahtarı gerekli" ve tüm hücreler "–"; OnchainOS anahtar/x402 istediği için veri BLOCKED) Sütun OKX OnchainOS | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.5 | DONE | (anvil bu ortamda yok → sütun gizli; karar mantığı simülasyonu destekliyor, test: "simülasyon çelişkide kazanır") Sütun Timos simülasyonu (a | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.6 | DONE | Logo yok; kaynak adı metin + kendi sade SVG ikonumuz | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.7 | DONE | Satırlar: Kontrat doğrulanmış, Honeypot, Alım vergisi, Satış vergisi, Proxy, Mintable, Vergi değiştirilebilir, Blacklist, Transfer durdurula | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.8 | DONE | Hücre: değer + durum noktası (yeşil/sarı/kırmızı/gri) + metin; alan yoksa "–" | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.9 | DONE | Özet pill'leri Tehlike/Uyarı/Nötr (n), tıklanınca filtre | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.10 | DONE | Karar rozeti PASS/WARN/BLOCK | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.11 | DONE | Her satırda (i) "neden önemli" | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.12 | DONE | Çelişkide sarı kenarlık + "Kaynaklar çelişiyor" | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.13 | DONE | En sağda "Timos kararı" sütunu (oylama kuralları) | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.14 | DONE | Satıra tıklayınca ham değerler (Pro'da varsayılan açık) | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.15 | PARTIAL | (2 temiz demo: BSC USDT ve Avalanche USDC; doğrulanmış gerçek honeypot adresi bulunamadı, uydurulmadı → honeypot düğmesi BLOCKED) Demo düğme | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.16 | DONE | Sonuç SignalLedger'a; Telegram /tara metin tablo | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 6.17 | DONE | Test + ekran görüntüsü + commit | unit securityTable.test.ts; e2e "Güncelleme2 madde 6"; artifacts/screens/g2-madde6-guvenlik-{360,1440}.png |
| 7.1 | DONE | (Keşfet CEX, ısı haritası çekmecesi, Terminal "Arz özeti", Telegram /arz) Görünür: Keşfet CEX görünümü, Isı haritası çekmecesi, Pro Terminal | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.2 | DONE | Arz yapısı: max/total/circulating, dolaşım %, FDV/MC, Sınırlı/Sınırsız arz rozeti | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.3 | DONE | Arz değişimi 1G/1A/1Y (market_chart, MC/fiyat), yıllık enflasyon, "tahmini (MC/fiyat)" etiketi | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.4 | DONE | Arz azalıyorsa "deflasyonist (yakım)" | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.5 | DONE | Günlük > %1 sıçrama olay olarak işaretli (+ tanım değişikliği notu) | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.6 | PARTIAL | (DefiLlama emisyon API'si ücretli: HTTP 402 → config/unlocks.json ÖRNEK VERİ kullanılıyor) Kilit açılımı: önce DefiLlama; yoksa config/unloc | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.7 | DONE | Sonraki açılım tarihi, miktar, dolaşıma oranı, 30/90 gün toplam | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.8 | DONE | Arz baskısı skoru düşük/orta/yüksek + gerekçe; hold raporu kullanır | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.9 | DONE | 1 yıllık arz eğrisi grafiği + açılım tarihleri işaretli | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.10 | DONE | Önbellek 1 saat; rate limit → "veri yok" | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.11 | DONE | Takipteki coinde 7 gün içinde açılım → bildirim | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 7.12 | DONE | Test + ekran görüntüsü + commit | unit supply.test.ts + alerts "madde 7"; e2e "Güncelleme2 madde 7"; artifacts/screens/g2-madde7-arz-{360,1440}.png |
| 8.1 | DONE | OKX top trader L/S (hesap + pozisyon) | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.2 | DONE | Binance topLongShortAccountRatio / topLongShortPositionRatio / globalLongShortAccountRatio (5m), curl ile doğrulandı | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.3 | DONE | Sütunlarda kaynak etiketi; "top trader" tanım farkı açıklama balonunda | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.4 | DONE | Long yüzdesi = oran / (1 + oran) | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.5 | DONE | Coin bazında görünüm | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.6 | DONE | Özet satırları: BTC, ETH, Top 10, Top 20, All, Ex Top 20 | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.7 | DONE | Kategori bazında, 24 sa USDT hacmiyle ağırlıklı | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.8 | DONE | Güncelleme zamanı görünür | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.9 | DONE | Vadeli durum kartı bu verileri kullanır (hesap vs pozisyon ayrışması) | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.10 | DONE | Telegram /ls monospace tablo, /ls SOL tek coin | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.11 | DONE | Kategori long oranı eşiği (%75/%25, config) aşınca tek bildirim | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 8.12 | DONE | Test + ekran görüntüsü + commit | unit longshort.test.ts; e2e "Güncelleme2 madde 8"; artifacts/screens/g2-madde8-ls-{360,1440}.png |
| 9.1 | DONE | Basic mevcut tasarım korunur | unit themes.test.ts (AA); e2e "Güncelleme2 madde 9"; artifacts/screens/g2-madde9-terminal-{360,1440,dark/light}.png |
| 9.2 | DONE | Pro "Terminal" düzeni: solda izleme listesi (fiyat, 24 sa, funding, long%) | unit themes.test.ts (AA); e2e "Güncelleme2 madde 9"; artifacts/screens/g2-madde9-terminal-{360,1440,dark/light}.png |
| 9.3 | DONE | (Follow Line yerine "Trend çizgisi · TimosAI ATR" — P6 BLOCKED) Ortada büyük grafik (Follow Line, hacim, zaman aralığı) | unit themes.test.ts (AA); e2e "Güncelleme2 madde 9"; artifacts/screens/g2-madde9-terminal-{360,1440,dark/light}.png |
| 9.4 | DONE | Sağda order book derinliği + vadeli kartı + L/S + arz özeti | unit themes.test.ts (AA); e2e "Güncelleme2 madde 9"; artifacts/screens/g2-madde9-terminal-{360,1440,dark/light}.png |
| 9.5 | DONE | Altta sekmeler: pozisyonlar, emir geçmişi, paper istatistikleri, güvenlik taraması, ATK günlüğü | unit themes.test.ts (AA); e2e "Güncelleme2 madde 9"; artifacts/screens/g2-madde9-terminal-{360,1440,dark/light}.png |
| 9.6 | DONE | Pro renk dili: soğuk lacivert, yeşil/kırmızı PnL, amber yok, tabular-nums | unit themes.test.ts (AA); e2e "Güncelleme2 madde 9"; artifacts/screens/g2-madde9-terminal-{360,1440,dark/light}.png |
| 9.7 | DONE | Geçiş View Transitions API; reduced-motion'da animasyon yok | unit themes.test.ts (AA); e2e "Güncelleme2 madde 9"; artifacts/screens/g2-madde9-terminal-{360,1440,dark/light}.png |
| 9.8 | DONE | Gündüz/gece her iki sürümde; 4 palet; localStorage (try/catch); varsayılan sistem teması; AA kontrast | unit themes.test.ts (AA); e2e "Güncelleme2 madde 9"; artifacts/screens/g2-madde9-terminal-{360,1440,dark/light}.png |
| 9.9 | DONE | Test + ekran görüntüsü + commit | unit themes.test.ts (AA); e2e "Güncelleme2 madde 9"; artifacts/screens/g2-madde9-terminal-{360,1440,dark/light}.png |
| G1 | DONE | Tünel açıkken LIVE=false | e2e "API: anahtarlar hiçbir yanıtta geçmez"; .env LIVE=false |
| G2 | DONE | (README "Güvenlik" notu; LIVE=true öncesi tünel kullanıcı tarafından kapatılmalı) LIVE=true öncesi tünel kapatılır (README + kullanıcıya not | e2e "API: anahtarlar hiçbir yanıtta geçmez"; .env LIVE=false |
| G3 | DONE | Panelde anahtar/token görünmez | e2e "API: anahtarlar hiçbir yanıtta geçmez"; .env LIVE=false |
| S1 | DONE | Belge baştan sona yeniden okundu, eşleşmeyen cümle yok | npm test 118/118, typecheck temiz, Playwright 17/17 |
| S2 | DONE | npm test, npm run typecheck, Playwright duman testi sonuçları raporda | npm test 118/118, typecheck temiz, Playwright 17/17 |

Not: "Seviyeler" düğme adı GÜNCELLEME 2 madde 2'de açıkça istendiği için korunmuştur (çakışmada yeni belge geçerli).

## Elle deneme listesi
1. Terimler: herhangi bir sayfada üstte "Paper trade" etiketi (açıklama balonu), ısı haritasında Layer 1 / DeFi / AI / Payment.
2. Grafik: Isı haritası → coin → çekmecede grafik + AI analizi; "Trend çizgisi" (mavi/kırmızı, yön okları, lejant), "Seviyeler" (varsayılan kapalı).
3. Paper işlem + istatistik: Panel → Senaryoyu başlat → Paper istatistikleri kartı; Telegram `/al SOL 5`, `/l SOL 5x 20` (SİMÜLASYON); "Sıfırla".
4. Keşfet CEX: `/` → "av" → AVAX → parite sekmeleri (OKX'te AVAX-USDT / AVAX-USDC / AVAX-TRY; AVAX-BTC borsada yok) → AVAX-TRY (likidite düşük, "işlem izin listesinde değil").
5. Keşfet DEX: DEX sekmesi → BNB Chain + `0x55d398326f99059fF775485246999027B3197955` → güvenlik tablosu.
6. Güvenlik taraması: "Temiz: USDT (BNB Chain)" ve "Temiz: USDC (Avalanche)" demoları; honeypot demosu BLOCKED (doğrulanmış adres yok).
7. Arz dedektörü: Keşfet CEX → AVAX → "Arz dedektörü"; Telegram `/arz AVAX`.
8. L/S tablosu: Isı haritası altında Long/Short (Özet / Kategori / Coin); Telegram `/ls`, `/ls SOL`.
9. Pro + gündüz/gece: üstte Pro → Panel'den Terminal'e geçiş; güneş/ay düğmesi; Basic'e dönüş.
