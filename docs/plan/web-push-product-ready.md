# Web Push ile ilk yayın — ürün ve kabul sözleşmesi

**Ürün kararı:** 26 Eylül 2026. İlk yayın profili `push_first`: SMS ve WhatsApp gönderimi, OTP'si, pazarlaması ve otomatik fallback'i yoktur. Ürün sahibinin güncel talebi bu hedef için önceki WhatsApp transport tercihini değiştirir; bu belge runtime'ı değiştirmez.

**Görev:** PUSH-00; M / LIGHT, yalnız plan. Uygulama bütünü XL olduğundan aşağıdaki M/L dilimlere ayrılır. Canlı sahiplik ve durum yalnız [TASKS](../../TASKS.md#web-push-ilk-yayın-tracki) içindedir. [Ürün kuralları](../../PRODUCT_SPEC.md), [ajan protokolü](../../AGENTS.md) ve [Context Pack](context-packs.md) geçerlidir. Plan, kod teslimi, gerçek cihaz kanıtı ve yayın kabulü ayrı sonuçlardır.

## 1. İlk yayının kapsamı

| Kullanıcı | Teslim edilecek davranış | Açık sınır |
| --- | --- | --- |
| Salon sahibi / yetkili çalışan | Kurulum yardımı, test bildirimi, yeni randevu/iptal/değişiklik, kalıcı uygulama içi bildirim listesi, yetkili işlem ekranına geçiş | Ana takvim ve KolayApp menüsü korunur; her randevuyu manuel onaylatan yeni durum motoru eklenmez. |
| Randevu alan müşteri | Hesapsız rezervasyon, güvenli sonuç/yönetim, isteğe bağlı ortak müşteri PWA'sı ve Push, hatırlatma, değişikliği gördüğünü açık teyit, takvime ekle | Kurulum/izin rezervasyon şartı değildir; Push aboneliği telefon sahipliği değildir. |
| İzin vermeyen / desteklenmeyen cihaz | Aynı rezervasyon ve yönetim; kaydedilebilir yönetim bağlantısı, takvim seçeneği, açık bildirim durumu | Sayfadan ayrıldıktan sonra otomatik ulaşma garantisi yoktur; kritik durumda salonun arama işi görünürdür. |

İlk profilin ana bildirim kanalı Push olur. Yeni public rezervasyon için SMS/WhatsApp hesabı, template veya credential gerekmez. Mevcut isteğe bağlı randevu e-postası davranışı, kuyruğu ve yönetim bağlantıları korunur; e-posta rezervasyon şartı yapılmaz ve yeni otomatik Push→e-posta fallback'i eklenmez. Mevcut işletme hesabı e-posta doğrulama/parola kurtarma akışı da korunur; işletme auth'u bu çalışmada yeniden tasarlanmaz. `push_first` adı yalnız yeni yayın hedefidir; bugün var olan bir runtime flag'i olduğu varsayılmaz.

Kampanya yayını, bekleme listesi, sadakat/referral, indirimli kapora, iyzico, abonelik fiyatı ve AI bu ilk teslimatın parçası değildir. Bildirim tercih modeli operasyonel/pazarlama amaçlarını baştan ayırır; pazarlama gönderimi kapalı kalır. F16-06 promosyon kodunun varlığı kampanya gönderim yetkisi değildir. Ayrı iyzico çalışmasının kapsamı/kabulü değiştirilmez.

## 2. Mevcut koddan geçiş ve tarihsel kanıt

İnceleme tabanı: `c7b9a308f6c0ddb16245367ae8e1069a73526d81`. Uygulayıcı kendi current main'inde bu gözlemleri yeniden doğrular.

| Mevcut temel | Yeni işin sorumluluğu |
| --- | --- |
| [F16-02](phase-16.md#f16-02), [public recovery](../../worker/public-booking-recovery.ts) ve [müşteri formu](../../src/PublicBookingPage.tsx) tekli/grup create için WhatsApp telefon proof'u ister. | PUSH-01 yeni rezervasyon kabul sözleşmesini üretir. Mevcut kontrolü yalnız kaldırmak, sahte proof üretmek veya provider hazır değilken fail-open olmak kabul edilmez. |
| [F14 PWA testi](../../tests/f14-pwa-contract.test.mjs) service worker kaydını da yasaklayan mevcut korumayı doğrular. | PUSH-04 yalnız Push için dar service worker getirir; özel veri cache'i ve offline mali yazım yasağı davranış testiyle korunur. Eski test bu docs PR'ında değiştirilmez. |
| [Manifest](../../public/manifest.webmanifest) yalnız `/app/mobile`, `/app/` KolayApp kapsamındadır. | Müşteri manifest/kurulumu ve operator kurulumu ayrı, mevcut manifest id'si korunur. Müşteri kurulumu mevcutmuş gibi tüketilmez. |
| S03/F09 outbox, grup/olay sürümü ve müşteri bildirim projeksiyonu vardır. | PUSH-02/03 mevcut kalıcı olay, idempotency ve bakım yaklaşımını genişletir; ikinci bağımsız booking veya kontrolsüz gönderim motoru kurulmaz. |
| F16-02/G16 tarihsel kabulü WhatsApp OTP kapsamındadır; hosted residual ayrıdır. | Tamamlanmış tarihsel kartlar geri yazılmaz. PUSH track'i kapanmadan SMS/WhatsApp'sız ürün hazır değildir. |

[#627](https://github.com/ziyabeey/randevu/pull/627) OTP/Storage/TASKS/F16/staging yazarıdır; [#637](https://github.com/ziyabeey/randevu/pull/637) ROADMAP ve salon-domain planını taşır. PUSH-00 yalnız docs adayıdır: önce bu adaylar birleşir veya sahiplik açık devredilir, sonra PUSH-00 current main üzerine yenilenir ve yalnız atanmış belge bölümleri uzlaştırılır. Parent branch'ler, mevcut migration'lar ve kabul kanıtları değiştirilmez. #627'nin Storage kabulü kanal kararından bağımsız korunur. Netgsm/WhatsApp hosted kanıtı yeni profilin sağlayıcı kabulü yerine geçmez; eski OTP kanalını yeniden etkinleştirmek istenirse kendi açık kanıtı gerekir.

## 3. Telefon, kimlik ve rezervasyon yetkisi — PUSH-01

- Misafir müşteri hesabı zorunlu olmaz. Telefon iletişim için alınır, normalize edilir ve **doğrulanmamış iletişim bilgisi** olarak saklanır/gösterilir. Push izni, cihaz anahtarı, ad, telefon veya e-posta eşleşmesi telefon doğrulaması ya da hesap sahipliği üretmez.
- Aynı telefon/e-posta ile başka müşteri kaydını otomatik sahiplenme, birleştirme, profil güncelleme, geçmiş randevu/paket/bakiye okuma veya paket harcama yapılamaz. Yeni misafir rezervasyonunun contact snapshot'ı ile CRM müşteri kimliği ayrılır; mevcut müşteri eşleştirmesi varsa bu yoldan devralınamaz. Manuel CRM eşleştirme ayrıca yetkili/auditli kalır ve public erişim hakkı üretmez.
- Yeni rezervasyon kabul kanıtı yalnız dar bir create isteğini yetkilendirir; telefon-proof gibi adlandırılmaz. Sunucu bu kanıtı business/slug, create idempotency kimliği, normalize edilmiş istek özeti ve kısa süreli oturumla bağlar. Varsayılan TTL 10 dakikadır; commit sonrası aynı istek aynı sonucu kurtarır, değiştirilmiş istek yeniden kabul gerektirir.
- S04 actor/network/action kotaları, Worker gate'i, doğrudan RPC sınırı, K03 limitleri, tekli/grup parity ve DB çakışma son güvencesi korunur. Kanal kapatmak rate-limit veya anti-abuse kontrolünü kapatmaz. Mevcut admission yeterliliği ve uygulanacak bot challenge politikası PUSH-01 Context Pack'inde sayısal olarak dondurulur; açık kalırsa public cutover açılamaz.
- Yönetim yetkisi mevcut `/m#<token>` + POST-body capability/recovery çizgisinde kalır. Telefon girerek yönetim linki kurtarma veya bütün müşteri geçmişini bulma yolu yoktur. Kimlik doğrulanmadan tekrar erişim sözü verilmez.
- Operator Supabase Auth, aktif Membership, recovery-session sınırı, Origin/CSRF ve host-only cookie kuralları değişmez. Yeni dar RPC/grant/RLS yüzeyleri S08 envanterine girer; yalnız Worker kontrolü yeterli kabul edilmez.
- Yeni model eski politikadan açıkça sürümlenir. Policy/schema/runtime birlikte kabul edilmeden OTP guard'ı kaldırılmaz. Geçersiz/eksik profile veya key halinde yeni yol kapalıdır; SMS/WhatsApp'a otomatik dönüş yoktur.

## 4. Origin ve müşteri cihazı bağlama — PUSH-02

- Tek operator origin `randevu.kepenk.ai` kalır. Ortak müşteri yardımcı origin hedefi **`musteri.randevukolay.net`** olarak ayrılır; aynı ad salon slug'ı olamaz. DNS/host değişikliği DOMAIN-01 sahibiyle seri uygulanır. Bu belge hostname'in bugün canlı olduğunu söylemez.
- Salon sayfaları `{slug}.randevukolay.net` ve uyumlu `/r/:slug` akışı olarak kalır. Rezervasyon sonrası müşterinin açık eylemi ortak müşteri origin'inde top-level kurulum/bildirim akışını açar; iframe/üçüncü taraf cookie varsayılmaz.
- Originler arasında ham management/recovery token'ı query, redirect parametresi, Referer, log veya Push payload'ına konulmaz. Yetkili kaynak sayfa tek kullanımlık, kısa ömürlü, hedef-origin ve randevuya bağlı enrollment aktarımı üretir; fragment + POST ile tüketilir. Bu yeni dar capability R1 kabulü ister; kaynak ve hedef origin allowlist'i, replay/expiry ve başkasının randevusunu ekleme negatifleri zorunludur.
- Tarayıcıya server-issued, host-only HttpOnly cihaz oturumu bağlanır; sunucuda credential hash'i ve yalnız açıkça eklenen randevu izinleri bulunur. Cookie tek başına telefon/müşteri kimliği veya tenant-geneli hak değildir. Oturum en çok 30 gün geçerlidir; yeniden bağlama geçerli randevu capability'si ister. Mevcut public yönetim ayrı çalışır.
- Tek müşteri kurulumu, müşterinin ayrı ayrı yetkilendirdiği birden fazla salon randevusunu taşıyabilir. Telefon/e-posta üzerinden otomatik cross-salon toplama yoktur; yeni cihaz eski izinleri kendiliğinden devralmaz. PWA kurulumunda normal sekme ile standalone depolamanın paylaşılacağı varsayılmaz; aktarım ve sonuç kurtarma gerçek iPhone'da kanıtlanır.
- Push endpoint/key bilgileri hassas cihaz verisidir. Abonelik kaydı yetkili actor veya randevu capability'sine bağlıdır; istemci business/member/appointment ID'si authority değildir. Endpoint URL'leri loglanmaz; outbound gönderim yalnız doğrulanmış Push sağlayıcı hedeflerine, bounded timeout/body ile yapılır. İstemcinin serbest URL'sine sunucudan istek atılmaz.
- Çıkış, rol/üyelik iptali, randevu yetkisinin iptali ve cihazı kaldırma yeni gönderim ve detay erişimini keser. Her gönderimde alıcının güncel yetkisi yeniden değerlendirilir; işletme değişimi önceki işletmenin içeriğini mevcut ekrana taşımaz. Önceden ekrana düşmüş bildirimi uzaktan silme garantisi yoktur, bu nedenle bildirim içeriği asgari tutulur.
- `musteri` cookie'si ve operator cookie'si parent domain'e genişletilmez. Mevcut müşteri hesabı zorunlu değil kuralı korunur; merkezi müşteri hesabı/SSO/passkey projesi açılmaz.

## 5. Kalıcı olay, Push ve hatırlatma — PUSH-02/03

1. Rezervasyon/değişiklik commit'i, durable olay ve gerekli alıcı kaydını aynı güvenilir işlem sınırında üretir. Push arızası booking sonucunu geri almaz. Inbox'ta kaybolmayan kayıt bulunur; Push yalnız dikkat çekme kanalıdır.
2. İş kimliği business + randevu grubu/seri oluşumu + olay sürümü + alıcı/abonelik + bildirim türü + hatırlatma anını ayırt eder. Atomik claim/lease, bounded retry ve idempotency mevcut S03/K03 ilkelerini izler. Sağlayıcının cevabı kaybolduğunda mutlak tek teslim iddiası yoktur.
3. İlk reminder varsayılanı randevudan 24 saat ve 2 saat öncedir; geçmişe düşen an gönderilmez. Gönderim anı UTC instant, gösterim business IANA timezone'udur. İptal/taşıma, seri gelecek-oluşum değişikliği ve eski sürüm yeni gönderim başlatamaz; gönderim öncesi sürüm/durum yeniden okunur. Zaten sağlayıcıya kabul edilmiş dış teslim geri alınmış sayılmaz.
4. Her işin `expires_at` değeri vardır; hatırlatma randevu başlangıcından sonra geçerli değildir. Retry en çok 5 deneme ve bu süreyle sınırlıdır; `429/5xx` kontrollü geri çekilme, kalıcı `404/410` aboneliği pasifleştirme, hatalı payload/credential için alarm üretir. Sabit aralıkta sonsuz yeniden gönderim yoktur.
5. `provider_accepted`, ölçülebiliyorsa `device_received`, `notification_opened` ve kullanıcı eylemiyle `change_acknowledged` ayrı anlamlardır. Cihaz raporu sağlayıcı kanıtı değildir; ölçülemeyen alan **bilinmiyor** kalır. Açılma, okundu veya onaylandı diye adlandırılmaz.
6. Saat değişikliği teyidi randevunun güncel sürümüne bağlıdır; eski bildirimin teyidi yeni sürümü kapatamaz. Teyit gelmediğinde işletme listesinde takip/arama işi kalır. Teyit yeni slot ayırmaz ve randevu motorunun durumunu yeniden tanımlamaz.
7. Push içeriğinde telefon, e-posta, not, özel hizmet/fotoğraf/finans bilgisi veya yönetim token'ı yoktur. Başlık ve genel olay metni kullanılır; navigation locator tek başına veri okuma yetkisi değildir. Dokununca güncel server authority ile ilgili kayıt açılır. Kilit ekranda hassas bilgi olmaması iki işletme/rol için test edilir.
8. Declarative Web Push desteklenen Apple sürümlerinde kullanılır; diğer tarayıcılarda aynı notification sözleşmesini işleyen standart service worker yolu vardır. Zengin action button, ses, titreşim, badge veya Watch işlemi ortak zorunlu özellik sayılmaz. Her cihaz için temel yol: bildirime dokun → yetkili işlem ekranı.

## 6. Kurulum, izin ve kalıcı liste — PUSH-04

- Operator kurulumunda ve müşteri rezervasyon sonucunda bildirim yararı anlatılır; sistem izni yalnız kullanıcının eylemiyle istenir. iPhone ana ekrana ekleme adımı görünürdür. Instagram içi tarayıcı/desteklenmeyen ortam tespitinde normal tarayıcıda devam yolu vardır; cihazda olmayan API çağrılarak kullanıcı kilitlenmez.
- UI durumları: desteklenmiyor, kuruluma ihtiyaç var, izin sorulabilir, izin engelli, abonelik etkin, abonelik yenilemesi gerekli. Son görülen izin/başarılı test bugünkü teslim garantisi gibi sunulmaz.
- Test bildirimi ve kullanıcının ekrandan teyidi kurulum kanıtıdır; sonraki bütün bildirimlerin teslim garantisi değildir. Denied/default/unsubscribe rezervasyonu başarısız yapmaz. “Bildirimler kapalı; randevunuzu bu sayfadan takip edebilirsiniz” metni ve yönetim bağlantısını saklama yolu bulunur.
- Inbox push gönderimi başarısız olsa da server'dan okunur, okunmamış iş/olay listesi saklanır. Liste scoped ve sayfalıdır; var olan K03 limitleri kullanılır. Uygulama açılınca güncel randevu ve değişiklikler yeniden alınır.
- Push-only service worker'da private API/HTML/PII cache'i, offline mali/booking mutation kuyruğu, background sync ve sessiz arka plan işi yoktur. Scope private origin'de `/app/` ile sınırlı; müşteri origin'inde yalnız müşteri PWA'sına aittir. Eski KolayApp manifest id'si ve update compatibility korunur.
- Üç yüzeyde mevcut Türkçe/İngilizce mekanizması, klavye/screen-reader ve 360/390 px akışı kullanılır; yeni kurulum veya bildirim merkezi ana menüyü bozmaz. Çift dokunma ve offline halde onay/iptal tamamlandı gösterilmez.

## 7. Takvime ekleme — PUSH-05

- Başarı ekranında ve yetkili yönetimde Google Calendar / `.ics` seçeneği sunulur. Yerel takvimde kullanıcı kaydetmeyi tamamlar; yalnız butona basılması kayıt/hatırlatma kanıtı değildir.
- Etkinlikte salonun public adı/adresi, hizmetten bağımsız randevu başlığı, doğru başlangıç/bitiş ve saat dilimi bulunur. Telefon/not/özel hizmet/ham management token'ı Google URL'sine veya `.ics` açıklamasına taşınmaz. Yetki vermeyen güvenli takip locator'ı kullanılabilir.
- Sabit UID ve sürüm/tarih bilgisi üretilir; yinelenen indirme, DST, Türkçe karakter/escaping ve uzun başlıklar test edilir. Takvim uygulamalarının farklı import/update davranışı gerçek cihazlarda raporlanır; aynı UID'nin bütün istemcilerde deduplikasyon sağladığı söylenmez.
- Tek seferlik ekleme senkronizasyon değildir. Saat değişince eski takvim kaydının otomatik güncellendiği vaat edilmez; güncel randevu sayfası ve yeni takvim ekleme yardımı gösterilir. Takvim hiçbir cihazda kesin alarm garantisi veya Push teslim kanıtı yerine geçmez.

## 8. Sınırlı uygulama paketleri ve yazım sırası

Bu tablo durum tutmaz; durum/sahiplik TASKS'tadır. Her uygulama açılırken exact current main, tek owner, yazılabilir mevcut/yeni dosyalar ve Context Pack kaydedilir. Henüz var olmayan dosya/API varmış gibi tüketilmez. Shared writer kalıcı olarak belirlenmeden migration/router/CI yazılmaz.

| Paket | Boyut / bütçe | Mevcut kontrata bağlantı ve çıktı | Gerekli kanıt / bağımsız rol |
| --- | --- | --- | --- |
| PUSH-01 | L / STRICT | F16-02 devamı + F09-04: transportsuz misafir admission/contact/CRM sınırı; versioned policy; tekli/grup ve recovery | SQL clean/upgrade, RPC/HTTP abuse/identity negatifleri ve concurrency; bağımsız R1. UI değişimi PUSH-04'e aktarılır. |
| PUSH-02 | L / STRICT | F09-03/S03 + DOMAIN-01: subscription, device enrollment, scoped inbox ve yeni origin authority sözleşmesi | RLS/grant/direct-RPC, cross-tenant/actor, expiry/replay/revocation; R1. Host gerçek tarayıcı kabulü PUSH-06'dadır. |
| PUSH-03 | M / FOCUSED | S03/F16-01: şifreli Web Push adapter, mevcut durable dispatch, event-version/reminder lifecycle | Gerçek dispatcher + fake provider kontrollü başarısızlık/race testleri; sender yetkisi değişirse STRICT/R1'e yükseltilir. |
| PUSH-04 | L / FOCUSED | F12-05/F14-05: operator/müşteri kurulumu, izin/listeler, değişiklik teyidi, dar service worker | Gerçek browser yolculuğu, no-cache/no-offline-write ve auth-bound click; bağımsız R2. Backend contract önce donar. |
| PUSH-05 | M / FOCUSED | F12-05: takvim export/link ve değişiklik metinleri | Parse edilebilir ICS, timezone/escaping/mahremiyet testleri + gerçek takvim importu; R2 kanıtı PUSH-06 ile birlikte olabilir. |
| PUSH-06 | L / FOCUSED | Pilot öncesi gerçek Push delivery, release preflight, cutover/rollback; F17-03/04 için kanıt | Exact release CI, gerçek iPhone + Android, cutover no-SMS/WA kanıtı ve risk alanı review'leri; auth/DB rollback kapsamı R1 ister. F17-04 öncesi tamamlanır; M23 pilotu bu paketin önkoşulu veya kapanış şartı değildir. |

Uygulama sırası: plan kabulünden sonra PUSH-01 ve PUSH-02'nin contract tasarımı yapılabilir; aynı DB/migration dosyasına paralel yazılmaz. PUSH-03, PUSH-02 storage/event sözleşmesini; PUSH-04, PUSH-01/02/03'ün kabul edilmiş API'lerini tüketir. PUSH-05 yalnız ortak link/authority sözleşmesi donunca izole geliştirilebilir. PUSH-06 bütün dilimlerin ortak release adayını pilot öncesinde doğrular. Kabul sırası PUSH-01…06 → F17-04 → F17-05/M23 → G17'dir; M23 yalnız F17-05'te gerçek pilotla kapanır. Tamamlanmış F12/F14/F16 taskları yeni özellik için yeniden sahiplenilmez; devam kimlikleri tarihsel kabulden ayrıdır.

## 9. Üretime hazır sayılma kapısı

[MVP kabul matrisi](../../MVP_ACCEPTANCE.md) M01…M31 kimlikleri korunur. Yeni profil özellikle M03/M05/M07/M10/M17/M20/M26/M27/M28/M30/M31 kapsamına işlenir; M23 aynı gerçek pilot kapısıdır. Yeni durum tablosu veya M32 eklenmez.

Asgari davranış kanıtı:

| Risk | Zorunlu sonuç |
| --- | --- |
| Kanal bağımsızlığı | SMS/WhatsApp secrets/account/template olmadan tekli ve grup booking + yönetim + Push çalışır; ağ/transport gözlemi ilgili sağlayıcılara **0 istek** gösterir. E-posta auth ile booking bildirimi ayrı ölçülür. |
| Telefon/CRM | Başkasının iletişim bilgisi mevcut profil/geçmiş/paket yetkisi vermez; yanlış/expired/replayed admission değiştirilmiş isteği geçirmez; meşru retry/recovery aynı sonucu verir. |
| İki işletme / roller / cihazlar | Üyelik iptali, logout, cihaz kaldırma, business switch ve revoked capability sonrası yeni özel gönderim/okuma yok; kuyruğa alınmış iş yeniden yetki kontrolünden geçer. |
| Gerçek mobil | Desteklenen eski standart-Push iPhone yolu ve iOS 18.4+ declarative yolu; gerçek Android/Chrome; standalone/kapalı uygulama, deny/re-enable, offline/reconnect, farklı origin'den kurulum ve oturum geri kazanımı. Emülasyon hosted teslim kanıtı sayılmaz. |
| Lifecycle | Duplicate/retry, provider kabul edip cevap kaybı, cancel/send yarışı, eski seri oluşumu, stale notification click/ack ve deadline expiry doğru; provider kabulü okundu/onaylandı değildir. |
| PWA mahremiyeti | Özel içerik cache/lock-screen/payload/log/Referer'a sızmaz; eski ve yeni SW/app sürümü, logout sonrası açma, offline mali işlem reddi kanıtlıdır. |
| Takvim | Apple/Google gerçek kullanıcı kaydı; doğru saat, metin ve güvenli takip; reschedule sonrası eski kayıt konusunda doğru uyarı. |
| Operasyon | PII'siz queue age/retry/dead-letter/invalid-subscription/permission/enrollment/ack sayaçları, key rotation, send kill switch, rollback ve destek/arama işi görünürdür. |

Her cihaz receipt'i exact build/commit, OS/tarayıcı sürümü, kurulum biçimi, izin/bağlantı durumu, UTC gönderim zamanı ve gözlenen cihaz sonucu taşır; gerçek telefon/endpoint/token loglanmaz. Teslim gecikmesi p50/p95 ve örnek sayısı olarak **ölçülür**, %99.9 veya her cihazda anlık teslim sözü verilmez. K03 server bütçesi/queue sınırı aşılırsa açık owner ve düzeltme gerekir.

PUSH-06, [#644](https://github.com/ziyabeey/randevu/pull/644) F17 preflight continuation'ında bu release profilinin PUSH kabul kanıtlarını da fail-closed kontrol eder. Tarihsel 54 kartın tamam olması yeni profili otomatik hazır yapamaz. Eksik gerçek cihaz, origin veya telefon/admission kanıtı `Engelli/Bekliyor` kalır; smoke/mock PASS yerine yazılamaz. F17-04 teknik/ürün kabulü, F17-05 bir tam salon günü M23'ü kapatır.

## 10. Cutover, geri dönüş ve maliyet sınırı

- İlk olarak staging'de yeni profil kapalı varsayılanla kurulur; salt kanal flag'i auth kabulünün yerine geçmez. Açık #627 ve iyzico migration zinciriyle serial merge/upgrade doğrulanır; eski migration düzenlenmez.
- Kabul edilen yeni public booking policy ve Push tek kontrollü profile geçişinde açılır. Geçiş anı/olay sürümü kaydedilir. Eski SMS/WhatsApp işleri için pending/leased durumlarına göre güvenli durdurma planı uygulanır; cutover sınırından sonra bu kanallara yeni iş veya outbound istek üretilmediği kanıtlanır. Önceden sağlayıcıya kabul edilmiş dış teslim geri alınmış sayılmaz. Mevcut isteğe bağlı randevu e-postası işleri kendi retry/idempotency sözleşmesiyle devam eder; e-posta kuyruğu bu karar nedeniyle bastırılmaz veya silinmez. Geçmiş receipt/snapshot'lar yeniden yazılmaz.
- Kill switch yalnız yeni Push gönderimini durdurur; randevu ve inbox kayıtlarını kaybetmez. Bildirim kesintisi görünürdür. Yeni booking policy güvenle geri alınamıyorsa **yeni public rezervasyon kapanır**, mevcut yönetim/operatör kullanımı korunur; otomatik SMS/WhatsApp veya eski OTP profiline geri dönüş yoktur.
- Abonelik verisi ve encryption/VAPID key sürümleri ayrılır. Rotation sırasında eski endpoint'lerin yeniden abonelik ihtiyacı, overlap/retirement ve revoked cihazların geri gelmemesi gerçek kanıtla belgelenir. Key değerleri repoya girmez.
- Operator cihazı en çok 5 aktif abonelik; müşteri cihazında her randevu bağlama ayrı yetkidir. Gereksiz kayıtlar mevcut retention modeline bağlanır: unclaimed enrollment en geç 10 dakika, sona ermiş cihaz oturumu en geç 24 saat içinde temizlenir; müşteri randevu-bildirimi içeriği randevu bitişinden 30 gün sonra ayıklanır. Kalıcı booking/mali audit ve güvenli recovery bu temizlikte silinmez.
- Mesaj başına SMS/WhatsApp bedeli yoktur; Worker/DB/kuyruk/izleme ve destek maliyeti vardır. Varsayılan kendi backend + standart Web Push/VAPID; yeni ücretli aracı hizmet bu planın bağımlılığı değildir. İlk pilotta salon başına gönderim/cihaz, queue ve destek süresi raporlanır.

## 11. Kaynaklar ve doğrulama sınırı

26 Eylül 2026'da birincil kaynaklardan kontrol edilen teknik temel:

- [WebKit: iOS/iPadOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): ana ekran, izin ve Apple Watch gösterimi.
- [Apple: Declarative Web Push](https://developer.apple.com/videos/play/wwdc2025/235/) ve [WebKit açıklaması](https://webkit.org/blog/16535/meet-declarative-web-push/): Apple sürüm desteği, fallback ve standart Push uyumu.
- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [notification actions](https://developer.mozilla.org/en-US/docs/Web/API/Notification/actions), [service worker origin](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register).
- [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030): provider kabulü, TTL ve teslimin ayrı anlamları.
- [Google Calendar import](https://support.google.com/calendar/answer/37118): import sürekli senkronizasyon değildir.
- [KVKK bildirim amaçlarının ayrılması](https://www.kvkk.gov.tr/Icerik/8578/mobil-uygulamalar-uzerinden-gonderilen-anlik-bildirimlere-iliskin-kamuoyu-duyurusu): operasyon ve pazarlama tercihleri birlikte zorlanmaz.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): grant ile row yetkisi ayrı doğrulanır. `supabase:supabase` okundu; changelog markdown web okuyucuda unsupported content-type döndü, okunmuş sayılmadı. Gerçek implementation öncesinde changelog tekrar kontrol edilir.

Bu kaynaklar API imkânını açıklar; bu repoda çalışan Push, tamamlanmış güvenlik incelemesi, gerçek cihaz teslimi veya production yayın kanıtı değildir.
