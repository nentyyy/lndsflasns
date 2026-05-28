import { InlineKeyboard } from 'grammy';
import { STARS_PACKS, getStarsPack } from '../../api/lib/config.js';
import { createStarsDeposit } from '../../api/lib/payments/stars.js';
import { TON_TOPUP_URL } from './config.js';

export { STARS_PACKS, getStarsPack };
export const getStarPack = getStarsPack;

// Create a deposit row + Stars invoice and send it to the user.
// Coins are credited only after the verified successful_payment update.
export async function sendStarsInvoice(ctx, packId = 'stars-shadow') {
  const userId = String(ctx.from.id);
  const { invoiceLink, pack } = await createStarsDeposit(userId, packId);

  if (invoiceLink) {
    await ctx.reply(`DEADWILL • ${pack.title}\n${pack.coins} монет + ${pack.bonus} бонус`, {
      reply_markup: new InlineKeyboard().url(`Оплатить ${pack.stars} ⭐`, invoiceLink)
    });
  } else {
    await ctx.reply('Платежи временно недоступны (BOT_TOKEN не настроен).');
  }
}

export function buildTonTopupUrl(pack = 'ton-vault-1') {
  return `${TON_TOPUP_URL}?pack=${pack}`;
}
