import { InlineKeyboard } from 'grammy';
import { MINI_APP_URL, PORTALS_URL } from './config.js';

export function playKeyboard() {
  return new InlineKeyboard()
    .webApp('🎴  Играть', MINI_APP_URL);
}

export function startKeyboard() {
  return new InlineKeyboard()
    .webApp('🎴  Играть в DEADWILL', MINI_APP_URL)
    .row()
    .url('💎  Пополнить через @send', PORTALS_URL);
}

export function depositKeyboard() {
  return new InlineKeyboard()
    .webApp('⭐  Пополнить Stars', MINI_APP_URL)
    .row()
    .url('💎  Пополнить TON через @send', PORTALS_URL)
    .row()
    .webApp('↩  Назад', MINI_APP_URL);
}

export function appKeyboard(path = '') {
  const url = path ? `${MINI_APP_URL}${path}` : MINI_APP_URL;
  return new InlineKeyboard().webApp('🎴  Открыть DEADWILL', url);
}
