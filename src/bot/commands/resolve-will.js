const premiumOutcomes = [
  'Крупный выигрыш: +4,800 монет',
  'Очень крупный выигрыш: +7,500 монет',
  'Множитель: следующий выигрыш x2.2',
  'Золотой бонус: NFT coupon shard + 2,000 монет',
  'Пустой пункт: попытка сгорела',
  'Проклятый долг: ставка списана, cooldown 15m'
];

export async function resolveWillCommand(ctx) {
  const roll = premiumOutcomes[Math.floor(Math.random() * premiumOutcomes.length)];
  await ctx.reply(`Печать сорвана.\n${roll}\nРаунд завершен.`, {
    reply_markup: {
      inline_keyboard: [[{ text: 'Открыть игру', web_app: { url: process.env.MINI_APP_URL || 'https://example.com/deadwill' } }]]
    }
  });
}
