export async function handleError(ctx, next) {
  try {
    await next();
  } catch (error) {
    console.error('Bot error', error);
    await ctx.reply('Система печатей временно недоступна. Попробуйте снова чуть позже.');
  }
}
