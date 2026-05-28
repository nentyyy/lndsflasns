import { sectionKeyboard } from '../lib/keyboards.js';

export async function shopCommand(ctx) {
  await ctx.reply(
    [
      'NFT Shop',
      'Монеты: Stars invoice или TON vault top-up',
      'Premium: Black Seal Pass',
      'NFT: Sigil of Closed Estate, Ledger of Night Claims, Executor Seal',
      'После покупки создается transfer-заявка в Portals App.'
    ].join('\n'),
    {
      reply_markup: sectionKeyboard('/shop')
    }
  );
}
