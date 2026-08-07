# QuantScope Puanlama ve Paper Trading Algoritması

> Bu doküman, uygulamanın mevcut kodundaki gerçek davranışı açıklar.  
> Referans tarih: 7 Ağustos 2026.

## 1. Genel akış

Sistemde kripto ve BIST için iki ayrı puanlama/paper trade hattı vardır:

```text
Piyasa verisi
    ↓
İndikatör ve yapı puanları
    ↓
Puan kalibrasyonu + güven puanı
    ↓
Piyasa bağlamı ile final puanı (kripto)
    ↓
Giriş filtresi ve sıralama
    ↓
Paper pozisyon açma
    ↓
Fiyat, puan, maliyet ve risk takibi
    ↓
Çıkış koşulu oluşunca pozisyon kapatma
```

Kripto ve BIST kasaları, pozisyonları ve işlem geçmişleri birbirinden tamamen ayrıdır. Hiçbir paper trade işlemi gerçek borsaya emir göndermez.

## 2. Kripto veri evreni ve tarama sıklığı

- Kaynak: canlı Binance spot mumları ve Binance Futures mark/funding verileri.
- Evren: USDT karşılığı bulunan, stablecoin olmayan, hacme göre ilk 50 coin.
- Zaman dilimleri: `5m`, `15m`, `1h`, `4h`, `1d`, `1w`.
- Tarama sıklıkları:

| Zaman dilimi | Yenileme |
|---|---:|
| 5m | 15 saniye |
| 15m | 45 saniye |
| 1h | 120 saniye |
| 4h | 300 saniye |
| 1d | 900 saniye |
| 1w | 3.600 saniye |

Canlı Binance mumları alınamazsa ilgili coin/frame `unavailable` kabul edilir. Demo veya fallback veriyle paper işlem açılmaz ve e-posta sinyali üretilmez.

## 3. Kripto teknik puanlama

Her indikatör önce yaklaşık `-100 … +100` aralığında yönlü bir alt puana çevrilir. Pozitif değer long, negatif değer short yönünü destekler.

### 3.1. Trend indikatörleri

| İndikatör | Hesaplama / puanlama |
|---|---|
| EMA 20 / EMA 50 | `clamp((EMA20 / EMA50 - 1) × 3500, -75, +75)` |
| Fiyat / EMA 200 | `clamp((Fiyat / EMA200 - 1) × 1200, -65, +65)` |
| MACD histogram | EMA12 − EMA26, ardından 9 periyot sinyal; `clamp((Histogram / ATR) × 180, -75, +75)` |
| ADX / DMI | Yönü `+DI` ve `−DI` belirler. ADX, DI ayrışmasıyla ölçeklenir ve `±65` ile sınırlandırılır. |
| EMA9 eğimi | EMA9’un beş mum önceki fiyata göre eğimi; `clamp((EMA9 / Fiyat[-6] - 1) × 1500, -65, +65)` |

### 3.2. Momentum indikatörleri

| İndikatör | Hesaplama / puanlama |
|---|---|
| RSI (14) | `clamp((RSI - 50) × 2, -70, +70)` |
| Stochastic %K (14) | `clamp((%K - 50) × 1,5, -70, +70)` |
| CCI (20) | `clamp(CCI / 2, -75, +75)` |
| Williams %R | `clamp((Williams %R + 50) × 1,4, -70, +70)` |
| ROC (10) | `clamp(10 mumluk değişim (%) × 20, -70, +70)` |

RSI, Stochastic ve Williams %R aynı korelasyon grubundadır. Bu nedenle üçü ayrı ayrı tam ağırlık almaz; grup içinde ortalanarak aşırı tekrarın önüne geçilir.

### 3.3. Hacim ve para akışı indikatörleri

| İndikatör | Hesaplama / puanlama |
|---|---|
| Relative Volume (20) | Son mum hacminin önceki 20 mum ortalamasına oranı; son mum yönüyle birlikte en fazla `±65` |
| OBV eğimi | OBV 5 ve 20 ortalaması farkının hacme normalize edilmiş hali; en fazla `±55` |
| Chaikin Money Flow (20) | `clamp(CMF × 260, -70, +70)` |
| Money Flow Index (14) | `clamp((MFI - 50) × 1,4, -70, +70)` |
| 50 mumluk VWAP sapması | `clamp(VWAP sapması (%) × 25, -65, +65)` |
| Taker Buy Ratio | `clamp((alış oranı - 0,50) × 500, -65, +65)` |

### 3.4. Piyasa yapısı: HH/HL ve LH/LL

Piyasa yapısı yalnızca tamamlanmış mumlarla değerlendirilir. Son 120 mum içinde iki mum sol ve iki mum sağ teyitli swing tepe/dipleri aranır.

- Son iki swing tepe ve son iki swing dip aynı yöndeyse yapı adayı oluşur.
- Her iki bacağın da en az `0,18 ATR` ilerlemesi gerekir.
- Teyitli `HH / HL` veya `LH / LL` yapısının ham puanı yaklaşık `14 … 38` aralığındadır.
- Hareket zayıfsa teyitsiz yapı en fazla `±10` puan alır.
- Yeterli swing yoksa 20’şer mumluk iki pencere karşılaştırılır; bu düşük güvenli yöntem en fazla `±18` üretir.
- Tepe ve dipler aynı yönü göstermiyorsa yapı puanı `0` olur.

Dolayısıyla tek başına bir `HH / HL` etiketi doğrudan `+65` vermez. Yapı ailesinin final teknik puandaki ağırlığı yalnızca `%12`’dir ve ayrıca güvenilirlik katsayısından geçirilir.

### 3.5. Mikro yapı ve istatistik

Yönlü puana katılanlar:

- İlk 10 emir defteri kademesinin alış/satış dengesizliği: en fazla `±65`.
- Son mum logaritmik getirisi: en fazla `±60`.

Yalnızca bilgi/risk amacıyla hesaplananlar:

- Bid–ask spread,
- return skewness,
- excess kurtosis,
- lag-1 autocorrelation,
- fiyat–hacim etkileşimi.

### 3.6. Volatilite ve risk indikatörleri

Hesaplanan göstergeler:

- ATR (14),
- Bollinger %B,
- Bollinger bant genişliği,
- 20 mumluk tarihsel volatilite.

Mevcut teknik final puan ağırlıklarında `Volatilite` ailesi bulunmaz. Bu göstergeler esas olarak piyasa rejimini, işlem yapılabilirliği, risk skorunu, stop/mesafe yorumlarını ve ekrandaki açıklamaları etkiler.

## 4. Aile puanları ve kalibrasyon

Bir aile içindeki indikatörler önce korelasyon gruplarına ayrılır. Aynı şeyi ölçen indikatörler grup içinde ortalanır. Her indikatör ayrıca şu güvenilirlik çarpanından geçer:

```text
etkin indikatör puanı =
    indikatör puanı × clamp(güvenilirlik / 80, 0,55, 1,00)
```

Varsayılan indikatör güvenilirliği `75`’tir. Emir defteri dengesizliği `58`, piyasa yapısı ise yapının kalitesine göre dinamik güvenilirlik kullanır.

Teknik aile ağırlıkları:

| Aile | Ağırlık |
|---|---:|
| Trend | %30 |
| Momentum | %22 |
| Hacim | %20 |
| Yapı | %12 |
| Mikro yapı | %10 |
| İstatistik | %6 |

Ham teknik puan:

```text
rawQuant =
    Trend × 0,30
  + Momentum × 0,22
  + Hacim × 0,20
  + Yapı × 0,12
  + MikroYapı × 0,10
  + İstatistik × 0,06
```

### 4.1. Kanıt tavanı

Bir aile ancak mutlak puanı en az `12` ise aktif kanıt sayılır. Tek bir güçlü indikatör veya aile final puanı gereksiz yere yükseltemez.

| Aynı yönü doğrulayan kanıt | Final puan tavanı |
|---|---:|
| Yetersiz/tekil kanıt | 22 |
| En az 2 aile, en az 1 çekirdek aile | 42 |
| En az 3 aile, en az 2 çekirdek aile | 58 |
| En az 4 aile, en az 3 çekirdek aile | 72 |
| Trend + Momentum + Hacim + Yapı birlikte | 85 |

Çekirdek aileler: Trend, Momentum, Hacim ve Yapı.

Ek sınırlamalar:

- Trend aynı yönü doğrulamıyorsa tavan en fazla `48`.
- En az iki aktif aile ters yöndeyse tavan en fazla `48`.

Son teknik puan:

```text
quantScore = yön × min(|rawQuant|, kanıtTavanı)
```

### 4.2. Güven puanı

```text
confidence =
  clamp(
      34
    + |quantScore| × 0,38
    + doğrulayanAileSayısı × 5
    + aileUyumu × 12
    - karşıAileSayısı × 5
    + (veriKalitesi - 65) × 0,08
    - spreadCezası,
    32,
    92
  )
```

- En az 200 mum ve emir defteri varsa veri kalitesi `96`.
- En az 100 mum varsa `84`.
- Daha azında `65`.
- Spread 4 baz puanı aşarsa güven puanından `10` düşülür.

### 4.3. Teknik yön etiketi

| Quant puanı | Etiket |
|---|---|
| `≥ +55` | STRONG LONG |
| `+20 … +54` | LONG |
| `-19 … +19` | NEUTRAL |
| `-54 … -20` | SHORT |
| `≤ -55` | STRONG SHORT |

## 5. Kripto piyasa bağlamı ve final puanı

Arka plan tarayıcısı Gemini çağırmaz. Teknik skor aşağıdaki deterministik piyasa bağlamıyla birleştirilir.

### 5.1. Bağlam bileşenleri

| Bileşen | Hesap | Bağlam ağırlığı |
|---|---|---:|
| Fear & Greed | `(değer - 50) × 2`, `-100 … +100` | %45 |
| İlk 50 coin piyasa genişliği | `(yükselen oranı - 50) × 1,4 + ortalama değişim × 7` | %35 |
| Son global haberler | Pozitif/negatif kelime eşleşmelerinin başlık başına puanı, sonra ortalama | %20 |

Global toplam piyasa değeri, 24 saatlik hacim, hacim/değer devir oranı ve BTC dominansı da alınır. BTC dominansı coin bazlı rotasyon düzeltmesine, devir oranı ise aktivite çarpanına girer.

Bağlam kaynaklarından biri yoksa mevcut kaynakların ağırlıkları kendi aralarında yeniden normalize edilir. Tüm bağlam fallback durumundaysa bağlam puanı kullanılmaz.

### 5.2. Final skor

Paper trading ve otomatik tarayıcıda LLM kullanılmadığı için:

```text
finalScore = quantScore × 0,80 + contextScore × 0,20
```

Bağlam yoksa:

```text
finalScore = quantScore
```

Gemini yalnızca kullanıcı analiz ekranındaki düğmeye bastığında çağrılır. Manuel LLM sonucu otomatik tarayıcı, e-posta alarmı veya paper trade giriş/çıkışını değiştirmez.

## 6. Kripto paper trading algoritması

### 6.1. Varsayılan portföy

| Parametre | Değer |
|---|---:|
| Başlangıç kasası | 100.000 TL |
| İşlem başına marjin | 1.000 TL |
| Kaldıraç | 5x |
| İşlem başına nominal büyüklük | 5.000 TL |
| Maksimum açık pozisyon | 10 |
| Giriş puanı | `|finalScore| ≥ 30` |
| Minimum güven | `%70` |
| Çıkış/nötr bölge | `|finalScore| ≤ 15` |
| Taker komisyonu | Her yönde `%0,05` |
| Fiyat kayması | Her yönde `%0,02` |
| Maintenance margin | `%0,5` |

### 6.2. Pozisyon açma

1. Son iki saat içinde güncellenmiş canlı Binance skorları alınır.
2. Sonuçlar `|finalScore|` azalan, sonra güven azalan sırada gelir.
3. Yalnızca yönü `long` veya `short` olanlar değerlendirilir.
4. `|finalScore| ≥ 30` ve `confidence ≥ 70` olmalıdır.
5. Her coinde yalnızca bir pozisyon açılır. Böylece o coinin sıralamada ilk gelen, yani en güçlü frame’i seçilmiş olur.
6. Aynı döngüde kapanan coin tekrar açılmaz.
7. Açık pozisyon sayısı 10’a ulaştığında yeni işlem açılmaz.
8. Binance Futures mark fiyatı yoksa işlem açılmaz.
9. Kasa, marjin + giriş komisyonu + giriş kaymasını karşılamıyorsa işlem açılmaz.

Örnek başlangıç maliyeti:

```text
Marjin             = 1.000 TL
Nominal            = 1.000 × 5 = 5.000 TL
Giriş komisyonu    = 5.000 × %0,05 = 2,50 TL
Giriş kayması      = 5.000 × %0,02 = 1,00 TL
Kasadan düşen      = 1.003,50 TL
```

### 6.3. Açık pozisyon takibi

Pozisyon açıldığı frame ile izlenmeye devam eder. Örneğin işlem `DOGEUSDT / 15m` ile açıldıysa çıkış kararı DOGE’nin 15m final puanına göre verilir.

Her döngüde:

- Binance Futures mark fiyatı güncellenir.
- Aynı coin/frame final puanı ve güveni güncellenir.
- Beklenen çıkış komisyonu ve fiyat kayması dahil net P/L hesaplanır.
- Funding zamanı gelmişse Binance’in güncel funding oranı uygulanır.

Mark fiyatı alınamazsa pozisyon korunur; uydurma fiyatla güncelleme veya kapatma yapılmaz.

### 6.4. Pozisyon kapatma koşulları

Koşullar öncelik sırasıyla:

1. **Likidasyon**
   - Long: mark fiyatı likidasyon fiyatına eşit veya altındaysa.
   - Short: mark fiyatı likidasyon fiyatına eşit veya üstündeyse.
2. **Yön değişimi**
   - Güncel skor yönü açık pozisyonun tersine döndüyse.
3. **Puanın nötrleşmesi**
   - `|currentScore| ≤ 15` ise.

Pozisyon puanı `+30` ile açılıp `+16` seviyesine gerilerse açık kalır; `+15` veya altına gelince kapanır. Short için aynı mantık mutlak değerle uygulanır.

Mevcut kodda ayrıca sabit stop-loss veya take-profit yoktur. Çıkış; skor, yön değişimi veya izole likidasyonla gerçekleşir.

### 6.5. Likidasyon hesabı

```text
mesafe = max(0,01, 1 / kaldıraç - maintenanceMargin)

long liquidation  = girişFiyatı × (1 - mesafe)
short liquidation = girişFiyatı × (1 + mesafe)
```

5x ve `%0,5` maintenance margin ile teorik mesafe `%19,5` olur.

### 6.6. P/L ve maliyet hesabı

```text
yönİşareti = long için +1, short için -1

grossPnl =
    yönİşareti × adet × (markFiyatı - girişFiyatı)

exitNotional  = adet × markFiyatı
exitFee       = exitNotional × %0,05
exitSlippage  = exitNotional × %0,02

netPnl =
    grossPnl
  + fundingPnl
  - entryFee
  - entrySlippage
  - exitFee
  - exitSlippage

ROE = netPnl / marjin × 100
```

Fiyat hiç değişmez ve funding sıfır olursa 5.000 TL nominal işlemde tahmini çift taraflı toplam maliyet `7,00 TL`’dir.

## 7. Kripto e-posta alarmı ile paper girişinin farkı

E-posta alarmı paper trade’den daha sıkı bir eşik kullanır:

| Kural | Paper trade | E-posta alarmı |
|---|---:|---:|
| Minimum mutlak final puan | 30 | 55 |
| Minimum güven | %70 | %70 |
| Yeniden kurulma seviyesi | — | `|puan| ≤ 45` |
| Normal tekrar bekleme süresi | — | 4 saat |
| Başarısız gönderim tekrar aralığı | — | 5 dakika |
| Dakikadaki maksimum alarm | — | 5 |

Yön değişirse normal 4 saatlik bekleme dolmadan yeni alarm üretilebilir. Aynı tarama turunda her coin için yalnızca en güçlü frame e-posta adayı olur.

## 8. BIST puanlama mantığı

### 8.1. Veri evreni

- TradingView Türkiye tarayıcısında `Value.Traded` değerine göre ilk 80 BIST hissesi.
- Zaman dilimleri: `5m`, `15m`, `1h`, `4h`, `1d`, `1w`.
- BIST verisi en az 15 dakika gecikmeli kabul edilir.
- Dizin kaynağı canlı TradingView sonucu değilse fallback satırları işlem adayı yapılmaz.
- Seçili hisse grafiğinde Yahoo Finance `.IS` mumları kullanılır; bu grafik verisi paper motorunun giriş puanını üretmez.

### 8.2. BIST teknik skor formülü

Başlangıç:

```text
score = TradingView Recommend.All × 55
```

Üzerine eklenen yerel kurallar:

| Koşul | Puan |
|---|---:|
| Fiyat ≥ EMA20 | +8 |
| Fiyat < EMA20 | -8 |
| EMA20 ≥ EMA50 | +8 |
| EMA20 < EMA50 | -8 |
| EMA50 ≥ SMA200 | +6 |
| EMA50 < SMA200 | -6 |
| RSI 55–70 | +8 |
| RSI 30–45 | -8 |
| RSI > 75 | -2 |
| RSI < 25 | +2 |
| MACD ≥ MACD Signal | +10 |
| MACD < MACD Signal | -10 |
| Günlük/frame değişimi > `%0,5` | +3 |
| Günlük/frame değişimi < `-%0,5` | -3 |

Sonuç yuvarlanır ve `-100 … +100` aralığına sıkıştırılır.

### 8.3. BIST güven puanı

Kullanılabilir ana veri sayısı:

- Recommend.All,
- RSI,
- MACD,
- MACD Signal,
- EMA20,
- EMA50,
- SMA200.

Yön uyumu ise şu dört girdinin çoğunluk oranıdır:

- Recommend.All yönü,
- Fiyat − EMA20 yönü,
- EMA20 − EMA50 yönü,
- MACD − MACD Signal yönü.

```text
confidence =
  clamp(
    35 + kullanılabilirVeriSayısı × 6 + yönUyumu × 18,
    0,
    95
  )
```

BIST yön etiketi:

| Puan | Yön |
|---|---|
| `≥ +20` | long |
| `≤ -20` | short |
| Arası | neutral |

## 9. BIST paper trading algoritması

### 9.1. Varsayılan portföy

| Parametre | Değer |
|---|---:|
| Başlangıç kasası | 100.000 TL |
| İşlem başına sermaye | 1.000 TL |
| Kaldıraç | 1x |
| Yön | Yalnızca long |
| Maksimum açık pozisyon | 10 |
| Giriş puanı | `score ≥ +30` |
| Minimum güven | `%70` |
| Çıkış puanı | `score < +15` |
| Komisyon | Giriş ve çıkışta `%0,05` |
| Fiyat kayması | Giriş ve çıkışta `%0,02` |

### 9.2. Aday seçimi ve pozisyon açma

1. 80 hissenin altı frame’deki canlı/gecikmeli skorları alınır.
2. Her hisse için en yüksek **pozitif** puanlı frame seçilir.
3. Puan eşitse güveni daha yüksek frame seçilir.
4. Hisseler puan azalan, sonra güven azalan sırada dizilir.
5. `score ≥ +30` ve `confidence ≥ 70` filtresi uygulanır.
6. En fazla 10 benzersiz hisseye long pozisyon açılır.
7. Her işlem için 1.000 TL sermaye ayrılır.
8. Aynı hissede ikinci pozisyon açılmaz.
9. Aynı döngüde kapanmış hisse tekrar açılmaz.
10. Kasa sermaye + giriş maliyetini karşılamıyorsa yeni işlem açılmaz.

Uygun koşulları sağlayan yalnızca dört hisse varsa sistem 10 sayısını doldurmak için daha zayıf altı işlem açmaz.

Başlangıç maliyeti:

```text
Sermaye            = 1.000 TL
Giriş komisyonu    = 1.000 × %0,05 = 0,50 TL
Giriş kayması      = 1.000 × %0,02 = 0,20 TL
Kasadan düşen      = 1.000,70 TL
```

### 9.3. Pozisyon takibi ve kapatma

Pozisyon, açıldığı frame’in puanıyla izlenir. Başka bir frame sonradan daha yüksek puana çıksa bile açık pozisyonun çıkış frame’i değişmez.

```text
currentScore < +15  → pozisyonu kapat
currentScore ≥ +15  → pozisyonu koru
```

Burada sınır kriptodan farklıdır:

- BIST’te `+15` açık kalır, `+14` kapanır.
- Kriptoda mutlak puan `15` seviyesine geldiğinde kapanır.

İlgili hisse/frame skoru alınamazsa pozisyon korunur. Eksik veya fallback veriyle zorunlu kapatma yapılmaz.

Mevcut BIST paper algoritmasında:

- short işlem yoktur,
- kaldıraç yoktur,
- funding yoktur,
- sabit stop-loss/take-profit yoktur,
- seans/hafta sonu filtresi yoktur,
- çıkış yalnızca seçilen frame puanının `+15` altına inmesiyle gerçekleşir.

### 9.4. BIST P/L hesabı

```text
adet = 1.000 TL / girişFiyatı

grossPnl       = adet × (markFiyatı - girişFiyatı)
exitNotional   = adet × markFiyatı
exitFee        = exitNotional × %0,05
exitSlippage   = exitNotional × %0,02

netPnl =
    grossPnl
  - entryFee
  - entrySlippage
  - exitFee
  - exitSlippage
```

Fiyat değişmezse 1.000 TL’lik BIST işleminde tahmini çift taraflı toplam maliyet `1,40 TL`’dir.

## 10. Zamanlayıcı ve kalıcı kayıt

- Ana zamanlayıcı her dakika çalışır.
- Kripto tarayıcısı dakika içindeki `0`, `15`, `30` ve `45`. saniye adımlarında vadesi gelen frame’leri tarar.
- Kripto paper portföyü bu adımlarda mark fiyatı ve mevcut skorlarla güncellenir.
- BIST paper motoru her dakikalık zamanlayıcıda bir kez çalışır.
- Yayın ortamındaki zamanlayıcı gecikirse aktif kripto tarayıcı senkronu ve BIST Paper durum isteği, motoru yalnızca süresi geldiyse çalıştıran yedek tetikleyicilerdir.
- BIST motorunda 50 saniyelik lease, kripto tarayıcısında ayrı lease kullanılır; üst üste binen iki döngünün aynı işlemi iki kez açması engellenir.
- Hesaplar, açık pozisyonlar ve kapanmış işlem geçmişi kalıcı D1/SQLite tablolarında tutulur.

## 11. Portföy metrikleri

Her iki paper portföyünde:

```text
unrealizedNetPnl = açık pozisyonların net P/L toplamı

equity =
    başlangıçKasası
  + realizedNetPnl
  + unrealizedNetPnl

totalNetPnl = equity - başlangıçKasası

winRate =
    kazananKapanmışİşlem / toplamKapanmışİşlem × 100
```

Komisyon ve fiyat kayması toplamları ayrı izlenir. Kriptoda funding P/L de ayrıca takip edilir.

## 12. Bilinen sınırlar ve yorumlama

- Paper sonuçları gerçek fill, sıra önceliği, likidite derinliği ve ani gap etkilerini tam olarak modellemez.
- BIST verisi gecikmelidir; sistemin gösterdiği giriş/çıkış gerçek zamanlı BIST emri gibi yorumlanmamalıdır.
- BIST komisyonu ve fiyat kayması sabit varsayımdır; aracı kurum tarifesi değildir.
- Kripto taker komisyonu sabit modeldir; kullanıcının Binance VIP seviyesi hesaba katılmaz.
- Haber duyarlılığı doğal dil modeli değil, belirli pozitif/negatif kelimelere dayalı deterministik başlık puanıdır.
- Kripto paper giriş eşiği `30`, e-posta eşiği `55` olduğu için paper işlemi açılmışken e-posta gelmemesi normaldir.
- LLM sonucu otomatik paper trading karar zincirinde yer almaz.
- Stratejinin kârlı olması garanti edilmez; gerçek para kullanmadan önce uzun süreli forward test ve parametre duyarlılık analizi gerekir.

## 13. Kod referansları

| Konu | Dosya |
|---|---|
| Kripto indikatörleri, aile ağırlıkları, HH/HL kalibrasyonu | `lib/analysis.ts` |
| Piyasa bağlamının final skorla birleşmesi | `lib/decision.ts` |
| Fear & Greed, hacim, genişlik ve haber puanı | `lib/market-context.ts` |
| Tarama sıklığı, e-posta eşikleri ve yeniden kurulum | `lib/background-scanner.ts` |
| Kripto paper giriş/çıkış ve P/L | `lib/paper-trading.ts` |
| BIST teknik puanı ve veri evreni | `lib/bist.ts` |
| BIST aday sıralaması ve P/L matematiği | `lib/bist-paper-math.ts` |
| BIST paper pozisyon yaşam döngüsü | `lib/bist-paper-trading.ts` |
| Dakikalık çalışma planı | `worker/index.ts` |
