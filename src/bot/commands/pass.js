import { sectionKeyboard } from '../lib/keyboards.js';

export async function passCommand(ctx) {
  await ctx.reply(
    [
      'Battle Pass • Closed Inheritance',
      'Level: 19',
      'Progress: 68%',
      'XP sources: games, dailies, weeklies, clan activity, purchases',
      'Premium line: priority transfer, exclusive rewards, nft discount.'
    ].join('\n'),
    {
      reply_markup: sectionKeyboard('/pass')
    }
  );
}
