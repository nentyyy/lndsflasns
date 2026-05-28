import { sectionKeyboard } from '../lib/keyboards.js';

export async function profileCommand(ctx) {
  await ctx.reply(
    [
      'nenty',
      'Balance: 248,500 coins',
      'Tier: Black Seal',
      'Pending transfers: 2',
      'Best win: 7,500'
    ].join('\n'),
    {
      reply_markup: sectionKeyboard('/profile')
    }
  );
}
