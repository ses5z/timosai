# GÜNCELLEME 3 – Checklist
Durum: `[ ]` · `[x] DONE` · `[~] PARTIAL` · `[!] BLOCKED` (neden). Başlangıç 16:45 · P1 hedef 17:25 · P2 18:05 · P3 18:25 · dondurma 18:30

## Protokol
- [ ] P1 Checklist oluşturuldu
- [ ] P2 Sıra P1 (1b dahil) → P2 → P3; 17:45 kesme kontrolü
- [ ] P3 Her madde: kod → test (npm test, typecheck) → Playwright 360/1440 → commit "G3 madde N"
- [ ] P4 BLOCKED dürüstlüğü, sahte veri yok
- [ ] P5 Harici uç noktalar curl ile doğrulandı → docs/VERI_KAYNAKLARI.md
- [ ] P6a Mentor kartı sabit satır: "Ajan kurulum taslağı; yatırım tavsiyesi değildir."; al/sat emretmez
- [ ] P6b LIVE=true ilk açılış varsayılanları: risk %0,5 · tek işlem 5 USDT · toplam 15 USDT · 3 pozisyon · stop zorunlu AÇIK
- [ ] P6c SHORT spot'ta "sat/bekle", yalnızca paper futures'ta short
- [ ] P7 Her 2 maddede durum raporu
- [ ] P8 Bitiş tablosu + elle deneme listeleri
- [ ] P9 Son kontrol: belge baştan okundu; npm test, typecheck, Playwright

## Ürün ilkesi
- [ ] U1 Planı ve limitleri kullanıcı yapar; ajan plana göre otonom uygular ve her adımı plana referansla açıklar

## Madde 1 – Mentor işlemi
- [ ] 1.1 "Seviyeler" düğmesi "Mentor işlemi" oldu; tıklanınca kart açılır ve seviyeler çizilir
- [ ] 1.2 15m, 1H, 4H, 1D trendi ayrı ayrı (trend çizgisi yönü + EMA eğimi)
- [ ] 1.3 Kartta dört gösterge: "15dk ↓ · 1s ↓ · 4s ↑ · 1g ↑"
- [ ] 1.4 Yön üst dilimlerden (4H + 1D); alt dilim (15m/1H) yalnızca giriş zamanlaması
- [ ] 1.5 Üst dilimler aşağı → SHORT, yukarı → LONG, çelişkili → "İşlem yok: zaman dilimleri çelişiyor"
- [ ] 1.6 Ajan "ele" ya da yön belirsiz → giriş/stop/hedef gösterilmez, yalnızca neden
- [ ] 1.7 Kart: yön, vade (scalp/swing/pozisyon), giriş bölgesi, stop (trend çizgisi ya da ATR, hangisi yazılı), hedef 1/hedef 2, R:R, güven (düşük/orta/yüksek), 2-3 gerekçe, "geçersiz olur eğer…"
- [ ] 1.8 SHORT: spot'ta "sat / bekle", paper futures'ta short açılabilir (kartta yazılı)
- [ ] 1.9 "Plana ekle" düğmesi
- [ ] 1.10 Test + ekran görüntüsü + commit

## EK 1b – Grafik zaman dilimleri
- [ ] 1b.1 Aralıklar: 1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 12H, 1D, 3D, 1W, 1M; bar yazımı OKX dokümanıyla doğrulandı, utc varyant kararı README'de
- [ ] 1b.2 Favori satırı + "Diğer ▾" menüsü; yıldızla favori (localStorage, try/catch)
- [ ] 1b.3 Basic favoriler 15m · 1H · 4H · 1D · 1W
- [ ] 1b.4 Pro favoriler 1m · 5m · 15m · 1H · 4H · 1D · 1W + klavye 1-7
- [ ] 1b.5 URL ?tf=4H okunur/yazılır; sayfalar arası korunur
- [ ] 1b.6 Sola kaydırınca eski mumlar parça parça yüklenir (önbellekli)
- [ ] 1b.7 Saat ekseni aralığa göre biçim, Europe/Istanbul
- [ ] 1b.8 Trend çizgisi seçili aralığın mumlarıyla yeniden hesaplanır
- [ ] 1b.9 Mentor işleminin çok zaman dilimli analizi grafik aralığından bağımsız
- [ ] 1b.10 Testler: bar parametresi, ?tf=, favoriler (hata dayanımı), Pro 1-7, Istanbul ekseni, rozetler sabit, sola kaydırma

## Madde 2 – Gemini
- [ ] 2.1 Kural tabanlıya düşme nedeni kontrol edildi (anahtar/kota/model) ve düzeltildi
- [ ] 2.2 Model adı resmi dokümanla doğrulandı; kural tabanlı yalnızca yedek
- [ ] 2.3 Mentor işlemi gerekçesini Gemini yazar; seviyeleri/yönü kod hesaplar

## Madde 3 – Planım
- [ ] 3.1 Panelde "Planım" kartı (Basic sade, Pro tüm alanlar); ajan yalnızca plana göre işlem açar
- [ ] 3.2 İzinli coinler (arama + çoklu seçim; varsayılan likit USDT)
- [ ] 3.3 İzinli yön: long / long + short (short yalnızca paper futures)
- [ ] 3.4 Vade: scalp / swing / pozisyon (zaman dilimi ağırlıkları)
- [ ] 3.5 Risk %, tek işlem maks, toplam maks, maks pozisyon, saatlik maks emir, kaldıraç tavanı (Pro)
- [ ] 3.6 Giriş şartları: min R:R, min fırsat skoru, trend çizgisi uyumu, vadeli kalabalık tarafa girme
- [ ] 3.7 Çıkış: hedef 1'de % kısmi kâr, trailing (trend çizgisi/ATR), maks süre
- [ ] 3.8 Günlük zarar uyarı eşiği (yalnızca uyarı)
- [ ] 3.9 Sabit 5 USDT kaldırıldı; paper varsayılanları 1000 / %1 / 100 / 400 / 4
- [ ] 3.10 Canlıda tek tavan: değer bakiyeyi aşamaz; çekim/transfer yasak
- [ ] 3.11 Emir günlüğünde plana referans ("Plan: risk %1 · R:R ≥ 2 · trend çizgisi uyumlu ✓")
- [ ] 3.12 Test + ekran görüntüsü + commit

## Madde 4 – Basic emir defteri / Pro günlük
- [ ] 4.1 Basic: emir defteri (saat · coin · yön · fiyat · tutar · durum · PnL), başka satır yok
- [ ] 4.2 Pro: ayrıntılı günlük + filtre (emir / uyarı / bildirim / zincir)
- [ ] 4.3 Test + ekran görüntüsü + commit

## Madde 5 – Bildirim şeridi
- [ ] 5.1 Limit metni: "Limit doluluğu: açık tutar 13/15 · pozisyon 3/3. Yeni işlem açılmayacak, mevcutlar yönetiliyor."
- [ ] 5.2 Bilgilendirmeler sağ altta kapanabilir toast; modal yalnızca kritik (devre kesici, canlıda günlük zarar)
- [ ] 5.3 Engellenen emir plana referansla: "ADA long planına uymadı: R:R 0.56 (planın min 2) · stop %9 (planın maks %6)"
- [ ] 5.4 Test + ekran görüntüsü + commit

## Madde 6 – İsabet ve mini backtest
- [ ] 6.1 Her mentor işlemi ve ajan emri kaydedilir; sonuç izlenir (hedef 1 / hedef 2 / stop / süre doldu)
- [ ] 6.2 Kartta ve Pro'da "Son 7 gün: n kurulum · %x hedefe ulaştı · ort. R"
- [ ] 6.3 Mini backtest: seçili coin + plan, son 30 gün, yalnızca kapanış, ileriye bakmadan
- [ ] 6.4 Sonuç: işlem sayısı, isabet %, ort. R, maks drawdown, long/short dağılımı; "Geçmiş performans geleceği garanti etmez."
- [ ] 6.5 Plan formunda "Bu planı son 30 günde test et"
- [ ] 6.6 Test + ekran görüntüsü + commit

## Madde 7 – Long/Short (yalnızca Pro)
- [ ] 7.1 Sade tablo: Coin · Account % · Position % (üst trader) · Genel % · Funding · 24 sa hacim; kaynak sekmesi OKX / Binance
- [ ] 7.2 Kapsam: OKX'teki tüm SWAP coinler; 5 dk önbellek, arka planda sırayla (hacme göre), aranan coin anında
- [ ] 7.3 Arama + filtreler: kategori, min hacim, long kalabalık >%70, short kalabalık <%35, üst trader ↔ genel ayrışması
- [ ] 7.4 Üstte özet (BTC, ETH, Top 10, Top 20, All, Ex Top 20) ve kategori satırları, hacim ağırlıklı
- [ ] 7.5 Basic'ten kaldırıldı (ısı haritası altı dahil); Basic'te yalnızca tek vadeli etiketi
- [ ] 7.6 Taker alış/satış birimi yazılı (kontrat / USDT)
- [ ] 7.7 Test + ekran görüntüsü + commit

## Madde 8 – Lite / Pro
- [ ] 8.1 Basic: kart tabanlı, büyük düğmeler, yönlendirmeli akış "Ne yapmak istersin?" (Keşfet / Planım / Emir defteri), serif + amber
- [ ] 8.2 Pro: yoğun, sistem grotesk + monospace sayılar, soğuk lacivert
- [ ] 8.3 Pro kısayolları: / arama, 1-4 zaman dilimi, P plan, L long/short
- [ ] 8.4 Pro üst gezinme: Terminal · Long/Short · Tarama · Planım · Emirler
- [ ] 8.5 Geçiş animasyonu ≈600 ms: logo + "Pro sürüme geçiliyor…" / "Basic sürüme geçiliyor…", View Transitions; reduced-motion'da yalnızca metin
- [ ] 8.6 Test + ekran görüntüsü + commit

## Madde 9 – Terminal düzeni
- [ ] 9.1 Sol ≈22%: izleme listesi (arama, sıralama, sabit yükseklik, iç kaydırma)
- [ ] 9.2 Orta ≈53%: grafik (zaman dilimi, trend çizgisi, Mentor işlemi) + sekmeli panel (Pozisyonlar · Emir defteri · Paper istatistik · Backtest · Güvenlik taraması · ATK günlüğü)
- [ ] 9.3 Sağ ≈25%: sekmeli tek kart (Order book · Vadeli · L/S · Arz) + altında Mentor işlemi özeti
- [ ] 9.4 Sabit yükseklik, panel içi kaydırma, boş alan yok; 1280px altında sağ sütun ortanın altına
- [ ] 9.5 Test + ekran görüntüsü + commit

## 18:10–18:30 Canlı kanıt ve dondurma
- [ ] C1 Tünel kapatılır
- [ ] C2 OKX API anahtarları .env'e (okuma + spot, çekim KAPALI)
- [ ] C3 LIVE=true ile tek küçük canlı spot işlem aç/kapat; OKX emir numarası "CANLI" etiketiyle panelde; sonra LIVE=false
- [ ] C4 Avalanche Fuji kaydı panelde; mainnet yoksa Fuji linki
- [ ] C5 18:30 dondurma, README güncelle, son commit
