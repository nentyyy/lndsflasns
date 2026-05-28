import { InlineKeyboard } from 'grammy';
import { MINI_APP_URL, PORTALS_URL, TON_TOPUP_URL } from './config.js';

export function appKeyboard(path = '') {
  const url = path ? `${MINI_APP_URL}${path}` : MINI_APP_URL;
  return new InlineKeyboard().webApp('Открыть DEADWILL', url);
}

export function startKeyboard() {
  return new InlineKeyboard()
    .webApp('Открыть DEADWILL', MINI_APP_URL)
    .row()
    .url('TON top-up', TON_TOPUP_URL)
    .url('Portals', PORTALS_URL);
}

export function sectionKeyboard(sectionPath) {
  return new InlineKeyboard()
    .webApp('Открыть раздел', `${MINI_APP_URL}${sectionPath}`)
    .row()
    .url('Support', 'https://t.me/deadwill_support');
}
