import { z } from 'zod';

// Solo game — arm
export const armSchema = z.object({
  modeId: z.enum(['cheap', 'premium']),
  clientSeed: z.string().min(1).max(64).optional(),
  idempotencyKey: z.string().min(8).max(64).optional()
}).strict(); // reject unknown keys (prize, reward, chance, multiplier, amount, finalBalance)

// Solo game — reveal (SECURITY: frontend sends only roundId + clauseIndex)
export const revealSchema = z.object({
  roundId: z.string().uuid(),
  clauseIndex: z.number().int().min(0).max(9)
}).strict();

// PvP buy — frontend sends only cardIndex + idempotencyKey (NO prize, NO amount)
export const pvpBuySchema = z.object({
  mode: z.string().min(1).max(32),
  cardIndex: z.number().int().min(0).max(35),
  idempotencyKey: z.string().min(8).max(64).optional()
}).strict();

// Deposits — only method + packId
export const depositSchema = z.object({
  method: z.enum(['stars', 'ton', 'cryptobot']),
  packId: z.string().min(1).max(64)
}).strict();

export function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', detail: parsed.error.flatten() });
    }
    req.valid = parsed.data;
    next();
  };
}
