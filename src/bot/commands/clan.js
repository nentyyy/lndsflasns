import { sectionKeyboard } from '../lib/keyboards.js';

export async function clanCommand(ctx) {
  await ctx.reply(
    [
      'Lan$oGift',
      'Role: Owner',
      'Season contribution: 251.6k',
      'Internal place: #2',
      'Council rank: #4'
    ].join('\n'),
    {
      reply_markup: sectionKeyboard('/clans')
    }
  );
}
