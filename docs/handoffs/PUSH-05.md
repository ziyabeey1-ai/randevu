# PUSH-05 — Takvime ekleme / Context Pack ve devir

## Atama

- **Görev / sahibi / UTC:** PUSH-05 / GPT-5.6 Sol uygulayıcı, ChatGPT koordinatör / 2026-09-26.
- **Yetki:** Kullanıcının `planı uygula` talebi. [Issue #65 izole kapsam devri](https://github.com/ziyabeey/randevu/issues/65#issuecomment-5849901765) bu kodun #627/#637 ile çakışmadan, kendi branch'inde başlamasına izin verir; onların dosya sahipliği korunur.
- **Boyut / sınıf:** M / FOCUSED; tersine çevrilebilir kullanıcı akışı. Canlı durum [TASKS](../../TASKS.md#web-push-ilk-yayın-tracki) içindedir.
- **Başlangıç main:** `c7b9a308f6c0ddb16245367ae8e1069a73526d81`. **Parent plan:** [PR #647](https://github.com/ziyabeey/randevu/pull/647) `702acea10f3042d6d195f73173ee89f70ab76dd0`. **Branch:** `push-05-calendar-export`. Aday head/CI ve PR canlı GitHub'dan okunur.

## Read first ve teslim amacı

[AGENTS](../../AGENTS.md), [ajan protokolü](../plan/agent-workflow.md), [PUSH-05 ürün sözleşmesi](../plan/web-push-product-ready.md#7-takvime-ekleme--push-05), [F12-05](../plan/phase-12.md#f12-05) ve mevcut yetkili rezervasyon sonuç/yönetim ekranları okunur. Her iki ekranda da her takvim eyleminden önce güncel `POST /api/manage/view` okunur; ham capability yalnız JSON POST body'dedir. Yönetim ekranı bu yanıtla görünür projection'ı da günceller. Google penceresi kullanıcı tıklamasında açılır ve mevcut sekme korunur. Tekli/grup bir etkinlik olarak, UTC anı ve IANA saat dilimiyle dışa aktarılır.

## Yazım alanı ve sıradaki sınır

Yazılabilir: `src/customer-calendar-export.ts`, `src/CustomerCalendarActions.tsx`, `src/PublicBookingPage.tsx` (yalnız onay sonucu), `src/ManageAppointmentPage.tsx` (yalnız yetkili görünüm), `src/i18n-en.ts` (yeni metinler), `src/customer-manage.css` (gerekirse sınırlı action stili), `tests/customer-calendar-export.test.mjs`, bu devir ve `TASKS.md` içinde yalnız PUSH-05 satırı.

`worker/app.ts`, WhatsApp/OTP, Supabase, migration, eski TASKS satırları, #637 domain/ROADMAP ve #644 preflight kapsam dışıdır. Kod branch'i #647'ye stack edilir ve #627/#637 açık writer'larıyla seri birleştirilir. Parent docs PR current-main'e uzlaştırılmadan bu branch hazır/merge yapılmaz.

## İnvariantlar ve kabul

- Google şablonunda yalnız public salon adı, genel etkinlik başlığı, UTC başlangıç/bitiş, geçerli timezone ve varsa public adres yer alır. URL, `.ics`, açıklama, dosya adı ve analytics/log tarafına müşteri telefonu/e-postası/notu, özel hizmet, ham yönetim token'ı veya linki taşınmaz.
- `.ics` kararlı UID, gerekli RFC 5545 alanları, UTF-8 için 75 oktet satır katlama, CRLF ve TEXT kaçışları üretir. Grup sürümü `SEQUENCE` olabilir; tekli projection monotonic sürüm taşımadığı için artan sıra/senkronizasyon garantisi sunulmaz. İlk event ve sonradan yeniden ekleme farklı takvim uygulamalarında çift kayıt üretebilir.
- Randevu sonucu belirsiz, iptal veya kısmi ise ekleme sunulmaz. Yeni yönetim sonucu doğrulanamazsa eski zamanla takvim eylemi açılmaz. Takvim kullanıcı tarafından kaydedilmedikçe eklenmiş sayılmaz; taşındığında önceki kayıt otomatik güncel sayılmaz.
- Gerekli kod CI/typecheck/build + zaman, DST, uzun Unicode, injection/PII, version/UID ve stale sonuç akışı için hedefli test; kullanıcı akışı ve erişilebilirlik için bağımsız FOCUSED/R2. Gerçek Apple/Google cihaz import kanıtı PUSH-06 release kapısında aranır; bu PR onu iddia etmez.

## Kanıt ve sonraki eylem

Yerel `node --test tests/customer-calendar-export.test.mjs` 8/8 PASS, `npm run typecheck` PASS, `npm run build` PASS, `node scripts/ci-docs.mjs` PASS, diff whitespace PASS. İlk exact-head [R2 incelemesi](https://github.com/ziyabeey/randevu/pull/648#issuecomment-5849992228) açık yönetim ekranından eski takvim kaydı ve Google'a gidince yönetim bağlantısının kaybı risklerini yakaladı; kod her eylemde güncel okuma ve yeni sekme/engelli popup için açık ikinci tıklama akışıyla düzeltildi. Yeni exact-head bağımsız kapanış incelemesi ayrıca gerekir. `control-browser` ile `127.0.0.1:5173` ve `localhost:5173` denendi; cloud tarayıcısı her iki yerel adresi `ERR_BLOCKED_BY_CLIENT` ile engelledi. Yerel görsel/gerçek cihaz kabulü yapılmadı. Kod CI'ı ve cihaz kabulü bu testlerin yerine geçmez. Kullanılan beceriler: `vercel:react-best-practices`, `vercel:agent-browser-verify` ve `control-browser`. Browser doğrulama girişimi başarısızlığı gizlenmez.

Sonraki somut adım: [izole code PR'ı #648](https://github.com/ziyabeey/randevu/pull/648) için düzeltme head'inin CI ve bağımsız FOCUSED review sonucunu PR receipt'ine bağla; #627/#637/#647 serial merge ve current-main uzlaştırması sonrasında gerçek Apple/Google takvim importunu PUSH-06 kapısında çalıştır.
