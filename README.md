# Trade Terminal

Trade Terminal; Binance spot verisini, açıklanabilir teknik indikatörleri ve bağımsız Gemini değerlendirmesini tek ekranda birleştiren Türkçe bir trade analiz terminalidir.

> Finansal tavsiye değildir. Üretilen skorlar ve model yorumları karar desteği içindir.

## Özellikler

- Binance üzerinden kapanmış mum, 24 saatlik özet ve order book verisi
- Trend, momentum, hacim, volatilite, yapı ve istatistik ailelerinde açıklanabilir skorlar
- Çoklu zaman dilimi görünümü ve likit parite tarayıcısı
- Gemini Interactions API ile JSON şemalı second-approver değerlendirmesi
- Gmail uygulama şifresiyle sunucu taraflı SMTP alarm gönderimi
- Cihazda saklanan fiyat alarmları ve sinyal geçmişi
- Binance erişilemediğinde açıkça işaretlenen sentetik demo akışı

## Gereksinimler

- Node.js `>=22.13.0`
- npm

## Yerel kurulum

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Yerel arka plan tarayıcısını ayrı bir terminalde başlatmak için:

```powershell
npm run scanner:local
```

Bu servis `.env.local` değerlerini Wrangler'a doğrudan `--env-file` ile verir,
yerel D1 durumunu korur ve worker beklenmedik biçimde kapanırsa temiz bir
Windows ortamıyla yeniden başlatır. Yayındaki terminale senkronizasyon yapan
kalıcı kurulum, erişim belirteçlerini kaynak kod yerine yerel servis
yapılandırmasından parametre olarak geçirir.

`.env.local` içindeki değerler yalnızca sunucu tarafından okunur:

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
FASTACT_EMAIL_SENDER=
FASTACT_EMAIL_APP_PASSWORD=
FASTACT_EMAIL_RECIPIENT=
```

`.env.local` Git tarafından yok sayılır. Gerçek anahtarları kaynak koda veya `NEXT_PUBLIC_` değişkenlerine koymayın.

## Kalite kontrolleri

```bash
npm run typecheck
npm run lint
npm test
```

`npm test`, üretim Worker paketini oluşturur; HTML kabuğunu, güvenlik başlıklarını ve API hata davranışını doğrular.

## Mimari

- `app/page.tsx`: terminal arayüzü ve cihaz-yerel alarm/sinyal durumu
- `app/api/market`: tek parite piyasa verisi
- `app/api/multi`: çoklu zaman dilimi mumları
- `app/api/llm-review`: Gemini tabanlı bağımsız risk değerlendirmesi
- `app/api/email`: doğrulanmış alarm/test e-postası gönderimi
- `lib/analysis.ts`: deterministik indikatör ve skor motoru
- `lib/binance.ts`: Binance normalizasyonu, kapanmış-mum filtresi ve kontrollü fallback
- `lib/smtp.ts`: TLS üzerinden Gmail SMTP istemcisi

## Operasyon notları

- Fiyat alarmları bu sürümde tarayıcıda tutulur ve yalnızca uygulama açıkken değerlendirilir.
- Gemini veya e-posta servisi kullanılamazsa arayüz bunu gizlemez; quant sonucu değişmeden kalır.
- Dağıtım anahtarları hosting ortamında secret olarak tanımlanmalıdır.
