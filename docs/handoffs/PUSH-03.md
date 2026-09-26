# PUSH-03 — İzole Web Push gönderici / Context Pack ve devir

## Atama ve sınır

- **Görev / sahip / UTC:** PUSH-03'ün yalnız gönderim adaptörü alt dilimi / GPT-5.6 Sol uygulayıcı, ChatGPT koordinatör / 2026-09-26.
- **Yetki:** Kullanıcının `planı uygula`, ardından ilk etapta SMS/WhatsApp pasifken Web Push ile ilerleme talebi. [Issue #65 izole kapsam devri](https://github.com/ziyabeey/randevu/issues/65#issuecomment-5850102958).
- **Boyut / bütçe:** M / FOCUSED; dış sağlayıcıya gönderim ve kriptografi, ancak yeni authority/DB/API yok. Planın genel durumu [TASKS](../../TASKS.md#web-push-ilk-yayın-tracki) içindedir.
- **Başlangıç main:** `c7b9a308f6c0ddb16245367ae8e1069a73526d81`. **Parent:** [PR #647](https://github.com/ziyabeey/randevu/pull/647) `702acea10f3042d6d195f73173ee89f70ab76dd0`. **Branch:** `push-03-webpush-provider`. PR ve candidate exact SHA canlı GitHub'dan okunur.

## Okuma ve teslim amacı

[AGENTS](../../AGENTS.md), [katkı rehberi](../../CONTRIBUTING.md), [ajan protokolü](../plan/agent-workflow.md), [PUSH-03 sözleşmesi](../plan/web-push-product-ready.md#5-kalıcı-olay-push-ve-hatırlatma--push-0203), mevcut [e-posta dispatch'i](../../worker/notifications.ts), RFC 8291/8292/8030 ve Cloudflare Worker Web Crypto belgeleri okunur. İzole adaptör, dışarıdan verilen abonelik ve yalnız genel olay işareti ile tek bir Web Push sağlayıcı isteği hazırlar/gönderir; kendi başına booking, inbox, subscription veya cron başlatmaz. Standart anahtar değişimi/şifreleme ve VAPID imzası gerçek protokol davranışıdır; sağlayıcı kabulü cihaz teslimi sayılmaz.

## Yazılabilir alan ve kapsam dışı

Yazılabilir: yalnız yeni `worker/web-push-provider.ts`, yeni `tests/web-push-provider.test.mjs`, bu devir ve `TASKS.md` içindeki yalnız PUSH-03 satırı. Uygulayıcı kod/testleri yazar, koordinatör TASKS/devir ve PR/CI kaydını yürütür; birinin dosyasını diğeri aynı anda yazmaz.

`worker/app.ts`, `worker/entry.ts`, `worker/notifications.ts`, e-posta kuyruğu, WhatsApp/OTP/SMS, migration/CI planı, PWA/manifest, origin/ROADMAP, #627/#637/#646 ve PUSH-05 sahipliği kapsam dışı. Adaptör mevcut Worker runtime'ında Node uyumluluk bayrağı veya yeni paket gerektirmez. Entegrasyon ancak PUSH-02 yetkili abonelik/outbox sözleşmesi, paylaşılan writer sırası ve ayrı exact-main acceptance ile yapılır. İstemciden serbest endpoint veya gizli payload'ı doğrudan alan yeni bir route eklenmez.

## İnvariant ve kabul

- Salt ile her gönderimde yeni P-256 ECDH anahtarı; aboneliğin `p256dh` ve `auth` anahtarlarıyla RFC 8291 `aes128gcm` tek kayıtlı şifreleme; VAPID için **ayrı** P-256 imza anahtarı ve RFC 8292 `aud`/`exp`. Yanlış base64/anahtar/point/oversize güvenli ret; özel anahtar veya ham endpoint loglanmaz.
- Sadece bilinen HTTPS Push sağlayıcı endpoint/port/path'i; kullanıcı adı/şifre, IP/localhost, redirect, belirsiz host ve gereksiz parametreler dış ağa istek başlatmaz. Timeout ve gövde bütçesi sınırlı; sağlayıcı yanıt gövdesi/endpoint loglanmaz.
- Payload yalnız kapalı izin listesindeki genel olay işaretini içerir; serbest metin, locator, müşteri telefonu/e-postası/notu, hizmet, yönetim token'ı ve URL'si bulunmaz. Bildirime dokunulduğunda ileride yapılacak scoped inbox okuması ayrı PUSH-02/04 kabulüdür. `201/202` sağlayıcı kabulü; `404/410` abonelik iptali önerisi, `429/5xx` sınırlı retry sonucu; gerçek tekrar güvenliği ve ön-gönderim yetki denetimi bu adaptörde iddia edilmez.
- RFC sabit vektöründen bağımsız şifreleme kanıtı veya kontrollü deterministik karşılaştırma, mock provider ile header/gövde/status/redirect/timeout negatifleri, `npm run typecheck`, `npm run build`, repo full CI ve bağımsız FOCUSED güvenlik/transport incelemesi gerekir. Gerçek cihaz/sağlayıcı teslimi PUSH-06 kapısıdır.

## Bilinen engel ve sonraki eylem

[#627](https://github.com/ziyabeey/randevu/pull/627) Worker router/OTP, [#637](https://github.com/ziyabeey/randevu/pull/637) domain/ROADMAP ve [#646](https://github.com/ziyabeey/randevu/pull/646) SQL/CI yazıyor. PUSH-01'de misafir kimliği CRM iletişim eşleşmesinden ayrılmadan OTP kontrolü kapatılamaz; bu modül kanal cutover'ı açmaz. PUSH-02 yetkili abonelik ve kalıcı inbox olmadan dispatch'e bağlanmaz. **Sonraki somut adım:** adapter ve testleri teslim edip exact-head CI/bağımsız inceleme ile taslak PR'a bağla; sonra PUSH-02'nin operatör abonelik/inbox yetki sözleşmesini seri writer devriyle uygula.
