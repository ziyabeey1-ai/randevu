import { useState } from 'react';
import { t } from './i18n';
import {
  calendarFilename,
  createCalendarIcs,
  googleCalendarUrl,
  isCalendarExportable,
  type CustomerCalendarEvent,
} from './customer-calendar-export';

type Props = {
  event: CustomerCalendarEvent;
  refreshEvent?: () => Promise<CustomerCalendarEvent>;
};

export default function CustomerCalendarActions({ event, refreshEvent }: Props) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function currentEvent() {
    const value = refreshEvent ? await refreshEvent() : event;
    if (!isCalendarExportable(value)) throw new Error(t('Bu randevu artık takvime eklenemez.'));
    return value;
  }

  async function openGoogle() {
    setBusy(true);
    setNotice('');
    try {
      const value = await currentEvent();
      window.location.assign(googleCalendarUrl(value));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Güncel randevu bilgisi alınamadı.'));
    } finally {
      setBusy(false);
    }
  }

  async function downloadIcs() {
    setBusy(true);
    setNotice('');
    try {
      const value = await currentEvent();
      const url = URL.createObjectURL(new Blob([createCalendarIcs(value)], { type: 'text/calendar;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = calendarFilename(value.businessName);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Güncel randevu bilgisi alınamadı.'));
    } finally {
      setBusy(false);
    }
  }

  if (!isCalendarExportable(event)) return null;
  return <section className="customer-calendar-actions" aria-labelledby="customer-calendar-title">
    <h2 id="customer-calendar-title">{t('Takvime ekle')}</h2>
    <p>{t('Bu tek seferlik bir eklemedir. Randevu değişirse takviminiz otomatik güncellenmez; güncel bilgiyi bu sayfadan kontrol edip yeniden ekleyin.')}</p>
    <div>
      <button className="public-secondary" type="button" disabled={busy} onClick={() => void openGoogle()}>{t('Google Takvim')}</button>
      <button className="public-secondary" type="button" disabled={busy} onClick={() => void downloadIcs()}>{t('Takvim dosyasını indir (.ics)')}</button>
    </div>
    <small>{t('Takvime kaydetme ve hatırlatıcı ayarları cihazınızdaki takvim uygulamasında tamamlanır.')}</small>
    {notice && <p className="public-booking-notice" role="alert">{notice}</p>}
  </section>;
}
