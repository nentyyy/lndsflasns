# DEADWILL — Финальный продакшен релиз

> Ты senior fullstack разработчик. Проект DEADWILL — Telegram Mini App PvP казино.
> Визуал готов, безопасность закрыта. Задача — финальный продакшен релиз.
> **Стек:** Node.js/Express, PostgreSQL, React, Telegram Mini App SDK

-----

## 1. АНИМАЦИЯ ТАСОВКИ КАРТ (PvP и Премиум)

Одинаковая анимация для обоих режимов, 4 фазы:

**Фаза 1 — Тасовка (3 сек, до старта раунда)**

- Все 36 карт быстро перемешиваются по полю (случайные позиции меняются местами)
- Каждый swap: 150–200ms, ease-in-out
- 8–10 итераций shuffle подряд

**Фаза 2 — Раскладка (1 сек)**

- Карты плавно встают на места 1–36
- Scale эффект при посадке

**Фаза 3 — Раунд идёт**

- Таймер стартует только после окончания анимации
- Карты доступны для выбора

**Фаза 4 — Reveal (после таймера)**

- Все карты одновременно флипаются (rotateY 0→180deg, 600ms)
- Каскадная задержка: 30ms между картами (слева направо, сверху вниз)
- Выигрышные карты (> 0 монет) — золотое свечение
- Нулевые карты — остаются тёмными
- Моя карта пульсирует отдельно

```css
.card { transform-style: preserve-3d; transition: transform 600ms ease; }
.card.revealed { transform: rotateY(180deg); }
.card-front, .card-back { backface-visibility: hidden; }
.card-back { transform: rotateY(180deg); }
```

Показать: React компонент `CardGrid` с анимациями + CSS.

-----

## 2. ИСТОРИЯ ИГР — ЛИСТАЛКА С ПЛАШКАМИ

**Экран “История игр”** (вкладка в профиле):

Каждая игра — плашка:

```
┌─────────────────────────────────────────┐
│ [аватар] nenty   +67 монет  ×3.4  #1234 │
│ PvP · 36 карт · 12 игроков · 2ч назад  │
└─────────────────────────────────────────┘
```

- Зелёная рамка — я выиграл, красная — проиграл, серая — не участвовал
- Клик → модал с деталями раунда:

```
┌──────────────────────────────────────┐
│          РАУНД #1234                 │
│  PvP · 12 игроков · 36 карт         │
├──────────────────────────────────────┤
│ #  │ Игрок     │ Карта │ Выигрыш    │
│ 1  │ 🥇 nenty  │  #17  │ +67 монет  │
│ 2  │ 🥈 kuckd  │  #3   │ +25 монет  │
│ 3  │ user123   │  #11  │ +12 монет  │
│ -  │ player456 │  #26  │  0 монет   │
└──────────────────────────────────────┘
```

- Мой результат выделен золотом
- Кнопка “Закрыть”

**Нумерация игр:**

```sql
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS round_number SERIAL;
```

- Глобальный счётчик, не сбрасывается при рестарте
- Показывать везде как `#1234`

**API:**

```
GET /api/rounds?limit=20&offset=0       — все раунды
GET /api/rounds/:id                     — детали раунда
GET /api/rounds/my?limit=20&offset=0   — мои раунды
```

Пагинация: бесконечный скролл.

-----

## 3. ОКОНЧАНИЕ PVP РАУНДА — RESULT MODAL

После таймера:

1. Бэкенд финализирует раунд → WebSocket `round:finished` с результатами
1. Фронт запускает Reveal анимацию (см. п.1)
1. Через 3 сек → ResultModal (slide up + fade in):

```
┌──────────────────────────────────────┐
│       РАУНД #1234 ЗАВЕРШЁН           │
├──────────────────────────────────────┤
│ 🥇 nenty      карта #17    +67 ₿    │
│ 🥈 kuckd      карта #3     +25 ₿    │
│ 🥉 user123    карта #11    +12 ₿    │
│ -  player456  карта #26     0 ₿     │
├──────────────────────────────────────┤
│  ВАШ РЕЗУЛЬТАТ: +25 монет ✨          │
├──────────────────────────────────────┤
│  [Следующий раунд]  [История игр]   │
└──────────────────────────────────────┘
```

-----

## 4. ПОПОЛНЕНИЕ — ПОЧИНИТЬ ВСЕ СПОСОБЫ

### A) Telegram Stars — динамическая сумма

**Проблема:** захардкожено 3000 Stars

Фикс:

- Инпут: мин 20, кратно 20
- Показывать: “20 Stars = 1 монета → вы получите X монет”
- Бэкенд создаёт invoice динамически:

```js
POST https://api.telegram.org/bot{TOKEN}/createInvoice
{ prices: [{ label: "Монеты DEADWILL", amount: starsAmount }] }
```

- После `Telegram.WebApp.openInvoice` success → зачислить `starsAmount / 20` монет
- Никакой захардкоженной суммы

### B) TON через TonConnect

**Проблема:** платёж не проходит

Фикс:

- Проверить инициализацию TonConnect: манифест, адрес кошелька
- Обязательный comment/memo для идентификации
- Polling `GET /api/deposits/:id/status` каждые 10 сек
- Таймаут: 30 минут → статус “Истекло”
- Зачислять: `Math.floor(tonAmount / 0.1)` монет

### C) Депозит через @send

Flow:

1. Нажать “Пополнить через @send”
1. `POST /api/deposits/create` → `{ address, memo, expiresAt }`
1. Показать карточку:

```
┌─────────────────────────────────┐
│   Отправьте TON через @send     │
│   Адрес: UQ...xxxx              │
│   Комментарий: 847291  ← memo   │
│   ⏱ Истекает через 28:45        │
│   [Копировать адрес]            │
│   [Открыть @send]               │
└─────────────────────────────────┘
```

1. Кнопка “Открыть @send” → `tg://resolve?domain=send`
1. Polling каждые 15 сек
1. При подтверждении → зачислить монеты + уведомление

-----

## 5. ЦЕНЫ В МАГАЗИНЕ — SEED В БД

```sql
CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_ton DECIMAL(10,2) NOT NULL,
  price_coins INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true
);

INSERT INTO gifts (id, name, price_ton, price_coins) VALUES
('cookie-heart','Cookie Heart',3.09,31),
('crystal-ball','Crystal Ball',7.24,73),
('cupid-charm','Cupid Charm',13.8,138),
('diamond-ring','Diamond Ring',19.3,193),
('durovs-cap','Durov''s Cap',425,4250),
('easter-egg','Easter Egg',2.49,25),
('electric-skull','Electric Skull',21.8,218),
('eternal-candle','Eternal Candle',4.14,42),
('eternal-rose','Eternal Rose',17.3,173),
('evil-eye','Evil Eye',5.23,53),
('faith-amulet','Faith Amulet',3.67,37),
('flying-broom','Flying Broom',7.29,73),
('fresh-socks','Fresh Socks',2.65,27),
('gem-signet','Gem Signet',51.9,519),
('genie-lamp','Genie Lamp',30.9,309),
('ginger-cookie','Ginger Cookie',2.74,28),
('hanging-star','Hanging Star',5.8,58),
('happy-brownie','Happy Brownie',2.78,28),
('heart-locket','Heart Locket',1149,11490),
('hex-pot','Hex Pot',2.86,29),
('holiday-drink','Holiday Drink',2.4,24),
('homemade-cake','Homemade Cake',3.36,34),
('hypno-lollipop','Hypno Lollipop',2.49,25),
('ice-cream','Ice Cream',2.2,22),
('input-key','Input Key',3.65,37),
('instant-ramen','Instant Ramen',2.2,22),
('ion-gem','Ion Gem',55.4,554),
('ionic-dryer','Ionic Dryer',11.0,110),
('jack-in-the-box','Jack-in-the-Box',2.56,26),
('jelly-bunny','Jelly Bunny',5.42,55),
('jester-hat','Jester Hat',2.47,25),
('jolly-chimp','Jolly Chimp',5.45,55),
('joyful-bundle','Joyful Bundle',4.77,48),
('khabib-papakha','Khabib''s Papakha',19.3,193),
('kissed-frog','Kissed Frog',35.3,353),
('light-sword','Light Sword',4.42,45),
('lol-pop','Lol Pop',2.23,23),
('loot-bag','Loot Bag',93.4,934),
('love-candle','Love Candle',6.49,65),
('mousse-cake','Mousse Cake',2.89,29),
('nail-bracelet','Nail Bracelet',88.9,889),
('neko-helmet','Neko Helmet',29.4,294),
('party-sparkler','Party Sparkler',2.66,27),
('perfume-bottle','Perfume Bottle',54.9,549),
('pet-snake','Pet Snake',2.57,26),
('plush-pepe','Plush Pepe',4997,49970),
('pool-float','Pool Float',2.31,24),
('precious-peach','Precious Peach',238,2380),
('pretty-posy','Pretty Posy',3.05,31),
('record-player','Record Player',7.16,72),
('restless-jar','Restless Jar',3.34,34),
('santa-hat','Santa Hat',2.69,27),
('scared-cat','Scared Cat',130.9,1309),
('sharp-tongue','Sharp Tongue',34.0,340),
('signet-ring','Signet Ring',24.5,245),
('skull-flower','Skull Flower',6.9,69),
('sky-stilettos','Sky Stilettos',12.4,124),
('sleigh-bell','Sleigh Bell',5.77,58),
('snake-box','Snake Box',2.01,21),
('snoop-cigar','Snoop Cigar',7.95,80),
('snoop-dogg','Snoop Dogg',3.89,39),
('snow-globe','Snow Globe',2.99,30),
('snow-mittens','Snow Mittens',3.03,31),
('spiced-wine','Spiced Wine',2.8,28),
('spy-agaric','Spy Agaric',3.97,40),
('star-notepad','Star Notepad',2.86,29),
('stellar-rocket','Stellar Rocket',3.09,31),
('swag-bag','Swag Bag',3.43,35),
('tama-gadget','Tama Gadget',2.42,25),
('timeless-book','Timeless Book',2.82,29),
('top-hat','Top Hat',6.42,65),
('toy-bear','Toy Bear',31.6,316),
('trapped-heart','Trapped Heart',9.56,96),
('ufc-strike','UFC Strike',10.3,103),
('valentine-box','Valentine Box',6.11,62),
('vice-cream','Vice Cream',2.02,21),
('vintage-cigar','Vintage Cigar',24.9,249),
('voodoo-doll','Voodoo Doll',22.4,224),
('westside-sign','Westside Sign',54.5,545),
('whip-cupcake','Whip Cupcake',2.14,22),
('winter-wreath','Winter Wreath',2.39,24),
('witch-hat','Witch Hat',3.53,36),
('xmas-stocking','Xmas Stocking',2.05,21)
ON CONFLICT (id) DO UPDATE SET
  price_ton = EXCLUDED.price_ton,
  price_coins = EXCLUDED.price_coins;
```

`POST /api/portals/buy` принимает **только** `{ giftId }`:

- Цена только из БД
- Если клиент прислал `priceCoins` или `giftName` → 400
- Несуществующий `giftId` → 404

-----

## 6. ИСТОРИЯ ОПЕРАЦИЙ — РЕАЛЬНЫЕ ДАННЫЕ

Убрать заглушку:

```
GET /api/transactions?limit=20&offset=0
```

Ответ:

```json
{
  "transactions": [{
    "id": "...",
    "type": "win",
    "amount": 67,
    "balanceBefore": 100,
    "balanceAfter": 167,
    "createdAt": "...",
    "meta": { "roundNumber": 1234, "giftName": null }
  }],
  "total": 150,
  "hasMore": true
}
```

Типы в UI:

- `deposit` → “Пополнение 🟢”
- `purchase` → “Покупка: [giftName] 🔴”
- `bet` → “Ставка в раунде #N 🔴”
- `win` → “Выигрыш в раунде #N 🟢”
- `refund` → “Возврат 🟢”
- `bonus` → “Бонус 🟢”

Если пусто → “Операций пока нет”

-----

## 7. РЕФЕРАЛЬНАЯ ССЫЛКА

**Проблема:** ссылка неправильная

Правильный формат:

```
https://t.me/{BOT_USERNAME}?start=ref_{userId}
```

```
GET /api/referral/link → { link, referralCount, coinsEarned }
```

- Кнопка “Копировать” → копирует в буфер + toast “Скопировано!”
- Кнопка “Поделиться” → `Telegram.WebApp.openTelegramLink`:
  
  ```
  Играй в DEADWILL — выигрывай TON и NFT подарки! {ссылка}
  ```
- Показать статистику: приглашено X человек, заработано Y монет

-----

## 8. УБРАТЬ FOUNDER BADGE

- Удалить отображение badge “FOUNDER” из UI везде
- Убрать поле `is_founder` / `founder` из ответов API
- Найти и удалить все проверки типа `username === "kuckd"` из кода
- Role `owner`/`admin` остаётся, badge не показывать никому

-----

## 9. ПРЕМИУМ РЕЖИМ — ЗАВИСАЕТ

Диагностика и фикс:

- Логировать все шаги запуска премиум раунда
- Таймер должен стартовать после анимации тасовки (см. п.1)
- 10 “печатей” списываются атомарно через `SELECT FOR UPDATE`
- Если ошибка при старте → rollback печатей + показать ошибку
- WebSocket для премиум работает так же как для PvP
- Показать внятную ошибку если что-то пошло не так

-----

## 10. ЧЕКЛИСТ ПЕРЕД РЕЛИЗОМ

### Безопасность

- [ ] X-Dev-User убран
- [ ] Dev fallback убран
- [ ] HMAC initData валидируется
- [ ] priceCoins от клиента игнорируется
- [ ] Admin роли проверяются на бэкенде
- [ ] Порт 3000 не торчит наружу

### Экономика

- [ ] 1 монета = 0.1 TON (строго)
- [ ] 20 Stars = 1 монета (строго)
- [ ] Баланс только в PostgreSQL BIGINT
- [ ] Все операции через таблицу transactions
- [ ] SELECT FOR UPDATE при списании
- [ ] Отрицательный баланс невозможен

### Игра

- [ ] Анимация тасовки в PvP и Премиум
- [ ] PvP раунд стартует, тикает, завершается
- [ ] Result modal появляется после раунда
- [ ] Нумерация раундов глобальная, не сбрасывается
- [ ] История игр с листалкой и деталями
- [ ] Бесплатное открытие каждые 10 ставок
- [ ] Loss protection: не более 4 нулей подряд

### Платежи

- [ ] Stars — динамическая сумма (не 3000)
- [ ] TON депозит работает
- [ ] @send flow работает
- [ ] Pending депозиты истекают через 30 минут

### UI

- [ ] Весь текст на русском
- [ ] Нижняя панель: ИГРА / СЕЙФ / ПРОФИЛЬ
- [ ] Safe area на iPhone (env(safe-area-inset-bottom))
- [ ] Баланс с пробелами: 148 329
- [ ] Реальная история операций (не заглушка)
- [ ] Реферальная ссылка правильная
- [ ] Founder badge убран
- [ ] Нет username проверок в коде

-----

## Формат ответа

Для каждого пункта:

1. Где искать проблему (файл/функция)
1. Исправленный код
1. Одна строка — как проверить

**Начни с пунктов 1, 3, 9 — они блокируют игру. Только код, минимум текста.**