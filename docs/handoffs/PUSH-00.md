# PUSH-00 — Web Push ilk yayın planı / Context Pack

## Atama ve sınır

- **Görev / sorumlu / UTC:** PUSH-00 / ChatGPT koordinatör / 2026-09-26.
- **Kullanıcı yetkisi:** Web Push yaklaşımını mevcut plana uygula; ilk etapta SMS/WhatsApp olmasın; product-ready kabulü ve repo kuralları korunsun.
- **Boyut / validation:** M / LIGHT; yalnız docs. Ürün uygulaması XL olduğundan PUSH-01…06 dilimlerine ayrılır.
- **Starting main:** `c7b9a308f6c0ddb16245367ae8e1069a73526d81`.
- **Branch:** `docs/push-00-product-ready-plan`. Candidate head ve PR, canlı PR kaydı/commit üzerinden okunur; bu dosyaya kendi commit SHA'sı yazılarak yeni head döngüsü üretilmez.
- **Atama:** [Issue #65 bounded claim](https://github.com/ziyabeey/randevu/issues/65#issuecomment-5849710654).
- **Canlı durum:** yalnız [TASKS](../../TASKS.md#web-push-ilk-yayın-tracki).

## Read first

1. [AGENTS](../../AGENTS.md), [CONTRIBUTING](../../CONTRIBUTING.md), [agent-workflow](../plan/agent-workflow.md), [context-packs](../plan/context-packs.md).
2. [Yeni ürün/kabul sözleşmesi](../plan/web-push-product-ready.md), [PRODUCT_SPEC](../../PRODUCT_SPEC.md), [MVP matrisi](../../MVP_ACCEPTANCE.md).
3. [F16-02](../plan/phase-16.md#f16-02), [F14-05](../plan/phase-14.md#f14-05), [domain sözleşmesi](../plan/randevu-kolay-domain-contract.md).

## Yazılabilir dosyalar

`PRODUCT_SPEC.md`, `ROADMAP.md`, `TASKS.md` (yalnız yeni PUSH bölümü), `MVP_ACCEPTANCE.md` (aynı M01…M31), `docs/plan/phase-09.md`, `docs/plan/phase-14.md`, `docs/plan/phase-16.md`, `docs/plan/phase-17.md`, `docs/plan/randevu-kolay-domain-contract.md`, `docs/plan/web-push-product-ready.md`, bu devir.

Runtime, SQL/migration, package/lockfile, workflow, DNS, secrets, provider gönderimi, iyzico ve staging çalıştırma kapsam dışıdır. Eski task satırları veya G16 geçmişi yeniden yazılmaz. Yeni UI/API/Push özelliği hazır gösterilmez.

## Shared writer ve merge sırası

- #627 TASKS/F16/OTP/Storage/staging/migration sahibi olarak kalır; #637 ROADMAP/salon-site planını taşır. Bu aday onların branch'lerini değiştirmez. **Önce #627/#637 merge veya açık scope handoff, sonra PUSH-00 current-main refresh + semantik hunk uzlaştırması.** Bu koşula kadar PR draft kalır; bağımsız görev kodu sahiplenilmez.
- #644 preflight M01…M31'i sabitler; bu aday yeni M satırı/CI kapısı üretmez. PUSH-06 ilgili preflight continuation'ında yeni profilin task/cihaz kanıtı kontrolünü ekler.
- Iyzi provider/ledger stack'i ve para sınırları değişmez; yeni kapora veya ödeme özelliği Push görevi içine alınmaz.

## Korunan ve değişen kontratlar

Korunan: tek canlı TASKS, tarihsel 54 kart/G16, account-optional public booking, K01/K03 ve S03/S04/S08, `/m#token` + POST-body recovery/capability, operator Membership/Origin/CSRF, host-only cookies, no-private-cache/no-offline-finance, immutable migration, mevcut isteğe bağlı randevu e-postası/kuyruğu, eski yönetim linkleri, F17/M23 kanıtı.

Değişen hedef: ilk yayın SMS/WhatsApp/OTP/fallback kullanmaz; telefon doğrulanmış sayılmaz. Ayrı kabul edilmiş admission/contact politikası olmadan mevcut proof guard kaldırılmaz. Ortak müşteri origin'i isteğe bağlıdır ve yalnız ayrı yetkilendirilen randevuları taşır. Push provider kabulü, gözlenebilen cihaz olayı, açılma ve açık değişiklik teyidi ayrıdır. Takvim exportu sürekli sync değildir.

## Kabul ve doğrulama

- Read-only bağımsız discovery, main'deki OTP guard, SW yasağı, operator manifest, active writer'lar ve #644 matris sınırını doğruladı. Bu discovery uygulama R1/R2 kabulü değildir.
- Yerel `node scripts/ci-docs.mjs` ve `git diff --cached --check` PASS. Base ile karşılaştırmada eski TASKS içeriği aynen korundu; M01…M31 kimlik/durumları değişmedi; eklenen 19 yerel fragment bağlantısı çözüldü; fark yalnız atanmış 11 Markdown dosyasıdır. Exact candidate/hash ve bağımsız docs incelemesi canlı PR receipt'inde kaydedilir.
- İlk bağımsız belge incelemesindeki PUSH-DOC-B1 (pilot önkoşul döngüsü) ve PUSH-DOC-B2 (istenmeyen e-posta kapsam daraltması) düzeltildi: PUSH-06 pilot öncesi kapanır; F17-04 → F17-05/M23 sırası korunur; mevcut isteğe bağlı randevu e-postası/kuyruğu devam eder. Profil adı `push_first` olarak netleştirildi. Kapanış verdict'i exact candidate üzerindeki bağımsız receipt'ten okunur.
- Runtime/typecheck/build/PG/browser/staging/real-device yapılmadı: bu aday yalnız belge değiştirir. Bunlar gelecekteki ürün dilimlerinin zorunlu kabulü olarak kaydedildi, docs testinin yerine geçtiği iddia edilmez.
- Okunan beceri: `supabase:supabase`; erişim/grant/RLS ve recovery sınırı için. Resmî WebKit/Apple/MDN/RFC/Google/KVKK/Supabase kaynakları planın kaynak listesinde. Supabase changelog markdown web reader tarafından reddedildi; okunmuş sayılmadı, uygulama öncesi yeniden kontrol gerekir. Google Drive/Library yönlendirme becerileri discovery sırasında okundu; deliverable git-backed olduğu için bu kanallara kopya veya değişiklik yapılmadı.

## Sonraki tek somut adım

Exact candidate draft PR'ında bounded bağımsız plan incelemesi ve CI sonucunu kaydet. #627/#637 sahiplik devri/merge sonrası current main'e yenile, yalnız atanmış doküman farklarını uzlaştır ve docs kabulünden sonra PUSH-01 için bağımsız uygulama Context Pack'ini aç. Planın hazır olması ürünün production'da hazır olduğu anlamına gelmez.
