import { sectionKeyboard } from '../lib/keyboards.js';

export async function buyWillCommand(ctx) {
  await ctx.reply(
    [
      'Система контрактов',
      'Дешевое завещание — вход 100 coins, мягче риск, компактные монеты.',
      'Премиум завещание — вход 1000 coins, крупные выплаты, golden bonus, x2 и cursed debt.',
      'В одном раунде всегда открывается только 1 из 5 sealed пунктов.'
    ].join('\n'),
    {
      reply_markup: sectionKeyboard('/play')
    }
  );
}
