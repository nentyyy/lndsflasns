# DEADWILL Product Design Specification

Version: 1.0  
Product: Telegram Mini App + Telegram Bot + Admin Panel  
Mode: Production-ready design handoff  
Audience: Product designer, UI designer, frontend team, backend team, motion designer, QA, product owner

## 1. Product Core

DEADWILL is a dark premium Telegram mini app about cursed wills, sealed contracts, black inheritance deals, rare NFTs, internal coins, risk, and controlled reward loops. The product should feel like an elite closed club where users interact with forbidden documents and sealed agreements, not like an arcade or a cemetery game.

The product must communicate five things at all times:

1. How many coins the player has.
2. How much the selected action costs.
3. That one round means opening exactly 1 of 5 sealed contracts.
4. What the player got after the reveal.
5. Where coins were spent or credited.

## 2. Experience Principles

### 2.1 Emotional Tone

- Dark premium.
- Adult, polished, expensive.
- Secret society meets fintech vault.
- Ritual, not chaos.
- Rewarding, but never cartoonish.

### 2.2 What To Avoid

- No graves.
- No shovels.
- No digging or dirt.
- No childish fantasy visuals.
- No acid green or over-saturated arcade colors.
- No cluttered HUD like low-budget gacha games.
- No fake luxury with random glow on every element.

### 2.3 Experience Keywords

- Obsidian.
- Sealed.
- Contractual.
- Forbidden wealth.
- Black glass.
- Wax seal.
- Gold dust.
- Violet smoke.
- Risk ledger.

## 3. Platform and Layout Rules

### 3.1 Platforms

- Telegram Mini App, portrait-first.
- iPhone and Android, optimized for 360x740 up to 430x932.
- Safe area aware on top and bottom.
- Touch-first, thumb-friendly navigation.

### 3.2 Global Layout Structure

- Top safe area spacer.
- Sticky top header.
- Scrollable content area.
- Fixed bottom navigation.
- Bottom content padding must always account for nav height plus iOS inset.

### 3.3 Layout Grid

- Base unit: 4px.
- Horizontal page padding: 16px.
- Distance between major sections: 20px to 24px.
- Distance between cards: 12px to 16px.
- Compact gap inside chips/rows: 8px.
- Card radius scale: 20px, 24px, 28px.

## 4. Visual Language

### 4.1 Color System

#### Base background

- `#070707`
- `#0B0B10`
- `#111119`
- `#171724`
- `#211333`
- `#3B1768`

#### Premium gold

- `#D6A84F`
- `#F2C76B`
- `#8A6228`

#### Positive / win

- `#36D98D`

#### Risk / debt / curse

- `#B3293A`
- `#6E101B`

#### Text

- Primary: `#FFFFFF`
- Secondary: `#E6E3EA`
- Muted: `#AEA8B8`
- Disabled: `#6D6877`

#### Functional overlays

- Glass fill: `rgba(12, 12, 18, 0.72)`
- Heavy overlay: `rgba(4, 4, 8, 0.82)`
- Gold border: `rgba(242, 199, 107, 0.28)`
- Violet border: `rgba(117, 84, 194, 0.28)`
- Crimson border: `rgba(179, 41, 58, 0.28)`

### 4.2 Materials

- Obsidian black glass.
- Smoked translucent panels.
- Soft gold dust particles.
- Violet ambient haze.
- Red cursed seal accents for danger only.
- Selective glossy highlights.

### 4.3 Shadows and Glow

- Default card shadow: soft black depth, 20-30 blur.
- Premium card glow: gold outer glow, low opacity, tight radius.
- Active game element glow: violet + gold blend.
- Danger glow: dark crimson edge only.
- Never stack more than two simultaneous glow layers per element.

### 4.4 Background Strategy By Screen

#### Home

- Dark notary chamber or abstract black vault.
- Soft candles, blurred shelves, safe door silhouette, dust in air.
- Background opacity reduced by dark overlay for legibility.

#### Play

- Near-black void with violet smoke and floating particles.
- Subtle radial focus behind selected envelope cluster.

#### Shop

- Premium display shelf or auction room.
- Gold bokeh reflections, shadowed cases, luxury spotlighting.

#### Clans

- Dark council room / guild chamber.
- Raised stage feel, banners or vaulted walls abstractly blurred.

#### Battle Pass

- Large season ledger / ritual book.
- Gold linework and slow glowing dust.

#### Profile

- Smoky black glass with restrained ambient particles.

## 5. Typography

### 5.1 Primary Font Direction

- Headings: Inter, Manrope, or SF Pro Display equivalent.
- Body: Inter or Manrope.
- Numeric emphasis: tabular-friendly sans serif.

### 5.2 Typographic Scale

- Page title: 28-32px, weight 800.
- Section title: 20-24px, weight 700.
- Card title: 16-18px, weight 700.
- Body: 14-15px, weight 500.
- Caption: 12-13px, weight 500.
- Micro labels: 11-12px, weight 700, tracked slightly.
- Balance number: 22-28px, weight 800.

### 5.3 Typographic Rules

- Strong contrast, no thin fonts.
- Small text must remain readable at 12px minimum.
- Use modest text shadows only on titles over textured backgrounds.
- Reward amounts and prices should always be visually dominant.

## 6. Iconography and Imagery

### 6.1 Approved Icon Themes

- Sealed envelope.
- Wax stamp.
- Contract document.
- Coin stack.
- Vault.
- Crown.
- Flame candle.
- Council crest.
- NFT frame.
- Portals transfer stamp.

### 6.2 Forbidden Icon Themes

- Grave.
- Tombstone.
- Shovel.
- Dirt mound.
- Skeleton comedy elements.

### 6.3 NFT Art Direction

- Rare documents, sigils, crests, black-metal seals, occult certificates, elite badges.
- Framing should feel collectible and premium.
- No meme-style NFTs.

## 7. Navigation

## 7.1 Bottom Navigation

Fixed bottom glass navigation with 6 tabs:

1. Home
2. Play
3. Clans
4. Pass
5. Shop
6. Profile

#### Visual rules

- Height: 68-80px excluding safe area.
- Background: dark glass blur, `rgba(10, 10, 16, 0.78)`.
- Top highlight border with gold-violet edge.
- Active tab: glowing pill or framed highlight, gold/violet gradient.
- Active icon: bright gold or white.
- Inactive icon/text: muted gray-lilac.

#### Interaction

- Tap scale: `0.97`.
- Soft haptic on tab switch.
- Quick opacity fade between screens: 140-180ms.

### 7.2 Top Header

#### Left cluster

- Avatar.
- Nickname.
- Clan badge or Premium badge.

#### Right cluster

- Coin balance pill.
- Add funds button.
- Language button.
- Menu button.

#### Header behavior

- Sticky on scroll.
- Background fades from transparent to dark glass after 24px scroll.
- Must never collide with Telegram header.

## 8. Screen Specifications

## 8.1 Home Screen

### Goal

Sell the fantasy immediately and route the player into the first game loop.

### Structure

1. Header.
2. Hero card.
3. Will mode quick entry.
4. Daily bonus card.
5. Battle pass progress card.
6. Live wins ticker.
7. Clan rank card.
8. Shop shortcut card.

### Hero Card

- Large black envelope with embossed gold seal.
- Background smoke.
- Short atmospheric tagline.
- Short utility copy.
- Two main CTA buttons below.

#### Copy example

- Title: `Проклятое завещание`
- Subtitle: `Выбери 1 из 5 контрактов и забери исход`

### Quick Mode Cards

#### Cheap Will

- Obsidian and silver styling.
- Lower entry cost.
- Lower-risk framing.
- Copy should mention accessible entry.

#### Premium Will

- Black and gold styling with violet edge glow.
- Higher cost.
- Strong premium emphasis.

### Daily Bonus Card

- Claim state.
- Cooldown state with timer.
- Claimed today state.

### Live Wins Feed

Shows short rolling lines:

- Avatar.
- Nickname.
- Will type.
- Reward amount.

#### Example

`Vanta открыл премиум завещание и получил +4 800`

### Home States

- New player.
- Returning player.
- Premium player.
- Insufficient coins.
- Daily reward claim available.
- Seasonal event active.

## 8.2 Play Screen

### Goal

Make the selection ritual clear, premium, and fast.

### Structure

1. Header.
2. Selected mode card.
3. Entry cost strip.
4. Possible outcome category chips.
5. Central selection field with 5 sealed contracts.
6. Rules hint strip.
7. Last results / history shortcut.

### Mode Header

- Mode title.
- Entry price.
- Short risk descriptor.
- Cheap / Premium switcher.

### Outcome Categories

Shown as readable tags, not percentages:

- Coins.
- Bonus.
- Empty.
- Debt.

Premium may include:

- Major win.
- Golden bonus.
- x2 multiplier.
- Cursed debt.

### 5-Contract Layout

Preferred mobile arrangement:

- Top row: 2 envelopes.
- Bottom row: 3 envelopes.

Alternative:

- Ring around a center seal if tested and readable.

### Envelope Design

#### Cheap

- Black or graphite paper.
- Silver trim.
- Dark violet seal.
- Lower glow intensity.

#### Premium

- Black enamel finish.
- Gold corners.
- Gold wax seal.
- Violet smoke aura.
- Premium border pulse.

### Play States

- Idle ready.
- Pressed.
- Selected pending reveal.
- Reveal animation running.
- Result positive.
- Result neutral empty.
- Result debt.
- Not enough balance.
- Connection retry.

## 8.3 Result Screen / Full-Screen Modal

### Goal

Deliver instant clarity and emotional payoff.

### Structure

1. Status title.
2. Central result block.
3. Supporting explanation.
4. Primary CTA.
5. Secondary CTA row.

### Result Variants

#### Coin win

- Title: `Ты получил`
- Main number in gold.
- Coin burst particles.
- Coins animate into header balance.

#### Multiplier

- Giant seal mark `x2`.
- Gold-violet burst.
- Text indicates next reward multiplier.

#### Golden bonus

- Rare ornate visual.
- Gold shards and smoke.
- Bonus descriptor and coin gain.

#### Empty contract

- Gray broken-paper state.
- Calm deflation sound.
- Copy must clearly say no reward credited.

#### Debt

- Red cursed stamp.
- Crack effect.
- Copy must clearly say stake lost.

### Result CTAs

- Primary: `Сыграть еще`
- Secondary: `История`
- Secondary: `В магазин`

## 8.4 Shop Screen

### Goal

Monetize clearly without breaking the premium tone.

### Tabs

1. Coins
2. Premium
3. NFT

### Coins Tab

Shows packs purchasable via TON or Telegram Stars.

#### Pack card contents

- Coin art.
- Pack title.
- Coin amount.
- Bonus tag.
- TON or Stars price.
- Main CTA `Заключить`.

### Premium Tab

- Premium pass.
- Premium access.
- Benefits list.
- Upgrade CTA.

### NFT Tab

#### NFT card contents

- Artwork.
- Name.
- Rarity.
- Price in coins.
- Stock or status.
- CTA `Купить`.

#### Rules

- Coins do not withdraw directly.
- NFT purchase creates transfer request.
- NFT delivery occurs via Portals App.

### Shop States

- Packs available.
- Premium owned.
- NFT sold out.
- NFT limited stock.
- Pending transfer created.

## 8.5 Transfer Center

### Placement

Accessible from Shop and Profile.

### Goal

Explain the bridge from coin spend to NFT delivery.

### List Item Structure

- NFT image/thumb.
- NFT name.
- Coin price.
- Purchase date.
- Status chip.
- Optional moderator comment.

### Statuses

- Pending: amber/gold.
- Approved: violet-blue.
- Completed: emerald.
- Rejected: crimson.

### Details Drawer / Sheet

- Request ID.
- Asset.
- Coin amount spent.
- Purchase timestamp.
- Transfer destination.
- Status history.
- Support note.
- `Обновить статус` button.

### Empty State

- Seal or envelope illustration.
- Copy: `Заявок на transfer пока нет`

## 8.6 Clans Screen

### Tabs

1. Мой клан
2. Чат
3. Топ кланов

### My Clan

#### Top clan card

- Crest/logo.
- Clan name.
- Level.
- Member count.
- Season contribution.
- Rank in overall leaderboard.
- Motto or description.

#### Member list row

- Place.
- Avatar.
- Nickname.
- Role.
- Coins earned this season.

#### Role visuals

- Owner: gold-black.
- Officer: silver-violet.
- Member: dark neutral.

#### Podium styling

- 1st place: gold.
- 2nd place: silver.
- 3rd place: bronze.

### Clan Chat

- Glass message bubbles.
- User messages dark.
- System event messages gold.
- Support pinned event rows.
- Can be embedded mini app chat or button to Telegram chat.

### Top Clans

- Ranked list.
- Top 1 gets expanded hero card with gold frame.
- Each row: place, logo, name, members, season coins, `Открыть`.

### Clan States

- User has clan.
- User has no clan.
- Pending invite.
- Clan full.
- Clan owner mode.

## 8.7 Battle Pass Screen

### Goal

Drive retention and premium conversion.

### Structure

1. Season header.
2. Countdown timer.
3. Current level.
4. XP progress bar.
5. Reward track with Free and Premium lanes.
6. Sticky premium purchase CTA if not owned.

### Reward Cell

- Icon.
- Reward title.
- Level number.
- State badge.

### Reward States

- Claimed.
- Claimable.
- Locked.
- Premium locked.

### Reward Types

- Coins.
- Tickets.
- Discount coupons.
- Temporary boosts.
- Premium attempts.
- NFT discount.

### Claim Reward Modal

- Large reward icon.
- Short confirmation copy.
- Main CTA `Получить`.

## 8.8 Profile Screen

### Goal

Summarize player identity, progression, and trust.

### Structure

1. Large identity card.
2. Stats grid.
3. Section links.
4. Optional recent activity.

### Identity Card

- Avatar.
- Nickname.
- Player ID.
- Premium status.
- Clan badge.

### Stats

- Games played.
- Coins won.
- Coins spent.
- Best win.
- Clan place.
- Login streak.

### Menu Sections

- История операций
- Мои NFT
- Заявки transfer
- Настройки
- Поддержка
- Правила

### Profile States

- Premium.
- Non-premium.
- No clan.
- No NFTs.

## 8.9 History Screen

### Filters

- Все
- Игры
- Магазин
- Пополнения
- Transfer
- Кланы

### Row Structure

- Icon.
- Operation title.
- Timestamp.
- Amount.
- Status.

### Color Rules

- Win: emerald.
- Spend: crimson.
- Purchase: gold.
- Transfer: violet.

### Operation Details

- Operation ID.
- Exact time.
- Type.
- Amount.
- Status.
- Comment or source.

## 8.10 Empty States

### Required variants

- No clan.
- No NFT.
- No history.
- No transfer requests.
- No live events.

### Style rules

- Use elegant iconography like envelope, seal, vault.
- Short copy.
- One strong CTA, one secondary optional CTA.

## 9. Component System

## 9.1 Buttons

### Primary

- Gold gradient fill.
- Dark text or white depending on brightness.
- Height: 48-56px.
- Radius: 16-20px.
- Soft gold glow.

### Secondary

- Dark violet glass.
- Border accent.
- White text.

### Danger

- Dark crimson gradient.
- Strong readable text.

### Ghost

- Transparent with border.

### Disabled

- Flat charcoal.
- Reduced contrast.
- No glow.

### Interaction

- Scale on press: `0.97`.
- Glow pulse: 160ms.
- Haptic on important confirms.

## 9.2 Cards

### Base

- Radius: 20-28px.
- Background: `rgba(10,10,15,0.72)`.
- Blur: 16-24px.
- Border: gold or violet translucent.
- Soft layered shadow.

### Premium

- Double border.
- Subtle moving gold particles.
- Stronger top glow.

### Danger

- Crimson edge.
- Hairline cracks or red seal only where contextually needed.

## 9.3 Pills and Chips

- Rounded, 999px.
- Used for status, filters, risk labels, pass level, rarity.
- Active filter should be filled, not only outlined.

## 9.4 Input Fields

- Dark glass.
- 48-52px height.
- Light border on focus.
- Numeric inputs use larger digits.

## 9.5 Bottom Sheets

Use for:

- Top-up.
- Confirm purchase.
- Operation details.
- Transfer details.
- Rules.
- Filters.

Rules:

- 20-28px top radius.
- Backdrop dark blur.
- One primary action max.
- Avoid long text walls.

## 9.6 Modals

Use full-screen modal for:

- Game result.
- Reward claim.
- Critical warning.

## 10. State System

## 10.1 Loading

Required loading overlays:

- `Проверяем контракт`
- `Создаем заявку`
- `Запечатываем завещание`

### Skeletons

- Home cards.
- Shop cards.
- Clan roster rows.
- Battle pass cells.

## 10.2 Error

Use atmospheric but clear copy:

- `Контракт не прошел`
- `Не удалось подтвердить покупку`
- `Связь с архивом потеряна`

Each error state must include:

- Reason or short clue.
- Retry action.
- Support route if payment/transfer related.

## 10.3 Insufficient Balance

Bottom sheet with:

- Current balance.
- Required amount.
- TON packages.
- Stars packages.
- Primary CTA to top up.

## 10.4 Success Feedback

- Toast.
- Coin flight to balance.
- Status chip update.
- Bot notification if relevant.

## 11. Animation and Motion

## 11.1 Motion Principles

- Smooth, not flashy.
- Luxurious inertia.
- Short and responsive.
- Visual emphasis on seal break, smoke, and currency flow.

## 11.2 Timing

- Quick tap feedback: 80-120ms.
- Screen transitions: 140-220ms.
- Card entrance stagger: 20-40ms per item.
- Reveal sequence: 1.0-1.5s max.
- Balance coin fly: 500-700ms.

## 11.3 Home Animations

- Hero dust drift.
- Soft glow on premium card.
- Live wins ticker auto-scroll.
- Daily reward pulse if claimable.

## 11.4 Play Reveal Animation

### Sequence

1. Tap envelope.
2. Selected envelope scales up slightly.
3. Rest blur and dim.
4. Camera focus darkens around center.
5. Envelope floats to center.
6. Wax seal cracks.
7. Smoke releases.
8. Paper opens.
9. Result symbol appears.
10. Coins or status stamp animates in.

### Result-specific motion

#### Coin win

- Gold flare.
- Coin particles.
- Header balance increment animation.

#### Multiplier

- Large embossed `x2` seal slam.

#### Empty

- Desaturation fade.
- Soft paper collapse.

#### Debt

- Red seal stamp slam.
- Quick dark flash.
- Hairline crack spread.

## 11.5 Button Motion

- Press compression.
- Release rebound.
- Premium CTA subtle shimmer every 6-8 seconds, never too often.

## 12. Game Logic UX Specification

## 12.1 Core Round

1. User chooses will type.
2. User sees price and outcome categories.
3. User confirms purchase if needed.
4. System deducts coins.
5. System shows 5 sealed contracts.
6. User opens exactly one.
7. Reveal runs.
8. Result is applied immediately.
9. Round ends.
10. User sees replay or exit actions.

## 12.2 Cheap Will UX

- Entry cost low.
- Framing emphasizes safer loop.
- Results:
  - Small win.
  - Medium win.
  - Good win.
  - Empty contract.
  - Debt.

## 12.3 Premium Will UX

- Entry cost high.
- Stronger materials and glow.
- Results:
  - Large win.
  - Very large win.
  - x2 multiplier.
  - Golden bonus.
  - Empty contract.
  - Cursed debt.

## 12.4 Economy Clarity

At all times show:

- Current balance.
- Price before confirm.
- Delta after round.
- Short transaction toast.

## 13. Monetization UX

## 13.1 Top-Up Methods

- TON.
- Telegram Stars.

## 13.2 Top-Up Card Contents

- Package amount.
- Bonus amount.
- Payment method label.
- Final price.
- Trust/support line if needed.

## 13.3 Premium Conversion Points

- Battle Pass.
- Premium Will mode emphasis.
- Premium membership bundle.
- NFT discount benefits.
- Priority transfer review.

## 13.4 Monetization Rules

- No direct cash withdrawal from coins.
- Coins are spent on gameplay, passes, premium access, and NFT purchases.
- NFT ownership exits the loop only through Portals transfer process.

## 14. NFT Transfer Flow

## 14.1 User Flow

1. User opens NFT tab.
2. Selects NFT.
3. Sees price and transfer note.
4. Confirms purchase.
5. Coins are deducted.
6. Transfer request is created.
7. User sees request in Transfer Center.
8. Status progresses through moderation and delivery.
9. NFT is transferred via Portals App.

## 14.2 Required User-Facing Statuses

- Pending review.
- Approved.
- Completed.
- Rejected.

## 14.3 System Notes

- Delay may be shown proactively.
- Suspicious requests can be held.
- Manual moderation message must remain calm and trustworthy.

## 15. Clan Flow

## 15.1 Join / Create Flow

- Empty state if user has no clan.
- Primary CTA `Создать клан`.
- Secondary CTA `Найти клан`.

## 15.2 My Clan Flow

1. Open clan tab.
2. View clan summary.
3. View member ranking.
4. Open clan actions.
5. Share or chat.

## 15.3 Owner Tools

- Approve applications.
- Remove member.
- Edit description.
- Edit avatar.
- Change roles.

## 15.4 Clan Ranking Logic

- Rank based on total season coins earned by members.
- Internal member place based on season contribution.

## 16. Battle Pass Flow

## 16.1 XP Sources

- Games.
- Daily quests.
- Weekly quests.
- Logins.
- Clan activity.
- Purchases.

## 16.2 Pass Flow

1. User opens pass.
2. Sees current level and time left.
3. Reviews free and premium rewards.
4. Claims available items.
5. Optionally upgrades to premium.

## 16.3 Premium Purchase Placement

- Sticky lower CTA on pass screen.
- Upgrade prompts in locked premium reward cells.

## 17. Telegram Bot Design

## 17.1 Bot Role

The bot is not the main gameplay surface. It is the notification, retention, support, and command layer around the mini app.

## 17.2 Bot Tone

- Short.
- Premium.
- Clear.
- Atmospheric but never confusing.

## 17.3 Bot Entry Points

- `/start`
- Deposit success notifications.
- Transfer request creation.
- Transfer completion.
- Battle pass level-up.
- Clan rank changes.
- Support escalation.

## 17.4 Bot Message Design Rules

- One headline line.
- One action summary line.
- One CTA button row.
- Avoid long paragraphs.

## 17.5 Bot Message Templates

### Deposit Success

- Title: `Баланс обновлен`
- Body: `На счет зачислено 12 800 монет`
- CTA: `Открыть DEADWILL`

### NFT Purchased

- Title: `Контракт заключен`
- Body: `Создана transfer-заявка для Portals App`
- CTA: `Открыть заявки`

### Transfer Completed

- Title: `Передача завершена`
- Body: `NFT отправлен через Portals App`
- CTA: `Открыть профиль`

### Pass Level Up

- Title: `Новый уровень сезона`
- Body: `Тебе доступна новая награда`
- CTA: `Открыть Pass`

### Clan Rank Update

- Title: `Клан поднялся выше`
- Body: `Новая позиция в сезонном рейтинге: #4`
- CTA: `Открыть клан`

## 18. Admin Panel Design

## 18.1 Platform

- Protected web admin recommended.
- Optional hidden admin mode in mini app for lightweight moderation.

## 18.2 Admin Visual Style

- Dark dashboard.
- Functional premium styling, lower decoration than player UI.
- Focus on readable tables, risk flags, and action clarity.

## 18.3 Admin Navigation

1. Users
2. Balances
3. Games
4. Wills
5. NFT Shop
6. Transfer Requests
7. Clans
8. Battle Pass
9. Analytics
10. Antifraud
11. Economy Settings

## 18.4 Users Screen

- Search by ID, handle, wallet, device.
- View profile snapshot.
- Risk score.
- Deposit history.
- Spend history.
- Clan and pass status.

## 18.5 Transfer Requests Screen

Each request should show:

- Request ID.
- User.
- Asset.
- Price paid.
- Status.
- Delay timer.
- Risk signals.
- Moderator notes.

Actions:

- Approve.
- Reject.
- Complete.
- Hold.

## 18.6 Antifraud Screen

Surface:

- Multi-account suspicion.
- Shared device fingerprint.
- Abnormal game frequency.
- Deposit bursts.
- Transfer velocity anomalies.
- Wallet reuse clusters.

## 18.7 Economy Settings

- Coin package config.
- Will prices.
- Reward pools.
- Pass rewards.
- NFT stock.
- Transfer delays.

## 19. Content and Microcopy Rules

## 19.1 Voice

- Atmospheric.
- Compact.
- Legible.
- Never too role-play heavy in transactional contexts.

## 19.2 Vocabulary Direction

Preferred flavor replacements:

- `Открыть завещание`
- `Заключить`
- `Контракт пуст`
- `Проклятый долг`
- `Заявка создана`

Keep direct utility terms where needed:

- Баланс.
- Цена.
- Купить.
- Заявка.
- Получить.
- История.

## 19.3 Transaction Copy Rules

- Always show exact numeric coin delta.
- Always clarify whether coins were added or spent.
- Always identify the destination of NFT transfer.

## 20. Accessibility and Readability

- Minimum body text 12px.
- Contrast ratio should remain strong despite glow.
- Tap targets minimum 44x44px, preferred 48x48px.
- Motion should be reduced for users with reduced-motion preferences.
- Important status must not rely on color only.

## 21. Technical UI Handoff Notes

## 21.1 Required Design Tokens

- Color tokens.
- Radius tokens.
- Shadow tokens.
- Spacing tokens.
- Typography tokens.
- Motion timing tokens.
- Status tokens.

## 21.2 Asset Buckets

- Background stills or loops per screen.
- Envelope states: idle, selected, premium, cheap, empty, debt, golden bonus.
- Seals: gold, violet, cursed red.
- Coin iconography.
- NFT thumbnails.
- Clan crests.
- Premium badges.

## 21.3 Frontend Implementation Guidance

- Prefer composable card and sheet system.
- Support skeleton states from day one.
- Separate economic data layer from presentation layer.
- Header balance should be globally reactive.

## 22. QA Checklist

### Core UX

- Balance visible on all primary screens.
- Entry price visible before every paid action.
- Player cannot open more than one contract per round.
- Result is understandable in under 2 seconds.
- Coin delta is visible after each result.

### Shop / Transfer

- NFT purchase always creates transfer request.
- No UI path suggests direct coin withdrawal.
- Status colors and labels are consistent everywhere.

### Clans

- Member ranking updates by season coins.
- Owner actions visible only for owner/officer roles.

### Battle Pass

- Claimed / available / locked states are visually distinct.

### Admin

- Risk indicators visible without opening deep detail views.
- Moderator actions require confirmation.

## 23. Production Definition of Done

The design is production-ready when:

1. Every listed screen has final layout, states, and edge cases.
2. Every action has a defined confirmation or result surface.
3. Color, type, spacing, and button systems are tokenized.
4. Game reveal animation is storyboarded and timed.
5. Transfer flow is clearly explained end to end.
6. Clan, pass, and profile sections support empty, loading, and error states.
7. Bot notifications are specified with CTA targets.
8. Admin actions and antifraud visibility are fully mapped.
9. The product still feels premium under real data density and not only in empty mockups.

## 24. Recommended Next Deliverables

1. High-fidelity mobile mockups for all 6 main tabs.
2. Motion storyboard for will reveal sequence.
3. Component library in Figma with tokens and states.
4. Bot message kit.
5. Admin dashboard wireframes and risk-table system.
6. UX copy sheet in RU and EN.
