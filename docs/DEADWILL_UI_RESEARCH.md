# DEADWILL UI Research Report

Date: 2026-05-27  
Scope: visual direction, mobile-first Telegram Mini App patterns, game contract loop clarity, premium monetization surfaces

## Reviewed References

Official / platform:

1. Telegram Mini Apps docs: https://docs.telegram-mini-apps.com/
2. Telegram Mini Apps overview: https://core.telegram.org/api/bots/webapps
3. Telegram Bot WebApps guide: https://core.telegram.org/bots/webapps

Dark premium fintech / wallet / luxury transaction UI:

4. Fintech Mobile App — Dark Dashboard UI: https://dribbble.com/shots/27014397-Fintech-Mobile-App-Dark-Dashboard-UI
5. Fintech Banking App UI — Dark Minimal Mobile App Design: https://dribbble.com/shots/27188976-Fintech-Banking-App-UI-Dark-Minimal-Mobile-App-Design
6. AI-Powered Fintech App · Dark Mode UI: https://dribbble.com/shots/26994018-AI-Powered-Fintech-App-Dark-Mode-UI
7. Fintech Mobile App – Dark Mode UI: https://dribbble.com/shots/25966862-Fintech-Mobile-App-Dark-Mode-UI
8. Modern Dark Fintech Mobile App UI Design: https://dribbble.com/shots/27354756-Modern-Dark-Fintech-Mobile-App-UI-Design
9. Fintech Wallet App UI Design (Dark Theme): https://dribbble.com/shots/27041754-Fintech-Wallet-App-UI-Design-Dark-Theme
10. Fintech Mobile App UI — Dark Mode Experience: https://dribbble.com/shots/27018114-Fintech-Mobile-App-UI-Dark-Mode-Experience

Casino / premium gaming / reward surfaces:

11. Mobile Skill Game - Dark Rewards UI: https://dribbble.com/shots/27042743-Mobile-Skill-Game-Dark-Rewards-UI
12. FairSpin: Premium Mobile Responsive Gaming UI: https://dribbble.com/shots/27127205--FairSpin-Premium-Mobile-Responsive-Gaming-UI
13. Mobile Shooter Game UI: https://www.behance.net/gallery/244316451/Mobile-Shooter-Game-UI

Battle pass / progression:

14. Battle Pass tag collection: https://dribbble.com/tags/battle-pass
15. Mobile Game Battlepass UI (WIP): https://www.behance.net/gallery/190342253/Mobile-Game-Battlepass-UI-%28WIP%29
16. Mobile Game Battle Pass Screen: https://www.behance.net/gallery/187052999/Mobile-Game-Battle-Pass-Screen

Leaderboard / clans / social competition:

17. Modern Leaderboard UI – Light & Dark Mode: https://dribbble.com/shots/26810692-Modern-Leaderboard-UI-Light-Dark-Mode
18. Day 19 - Leaderboard Status Dark & Light UI: https://dribbble.com/shots/26669254-Day-19-Leaderboard-Status-Dark-Light-UI
19. Gaming Hub & Leaderboard — Mobile App UI: https://dribbble.com/shots/27091537-Gaming-Hub-Leaderboard-Mobile-App-UI
20. Game Leaderboard Screens - Daily UI 019: https://dribbble.com/shots/21323614-Game-Leaderboard-Screens-Daily-UI-019
21. Game Leaderboard UI: https://dribbble.com/shots/16375838-Game-Leaderboard-UI
22. Overcooked 2! Leaderboard UI: https://dribbble.com/shots/14678064-Overcooked-2-Leaderboard-UI

NFT / web3 / marketplace:

23. Noce UI Kit - NFT Marketplace Mobile App: https://www.behance.net/gallery/176378311/Noce-UI-Kit-NFT-Marketplace-Mobile-App
24. NFT Marketplace UI Design: https://www.behance.net/gallery/154318579/NFT-Marketplace-UI-Design-Zamil-Ahamed

Supporting mobile product / premium structure:

25. myFawry app PDF case: https://cdn.dribbble.com/users/556112/screenshots/20059814/downloads/myFawry_%20%281%29.pdf

## 1. Visual Patterns That Fit DEADWILL

### What clearly works

- Narrow mobile stage framed around a single dominant content column.
- Strong “hero first” home screen with one large centerpiece object.
- High-contrast balance surface near the top, always visible.
- One primary action per screen, not many equal-weight buttons.
- Dark background + gold accent works best when gold is concentrated, not everywhere.
- Competitive features work better when top-3 / top-1 are visually elevated rather than shown as plain list rows.
- Reward systems feel premium when each reward cell is small but ornamental, not like dashboard stat tiles.
- Marketplace cards feel expensive when image/art area dominates and text is secondary.
- Game reveal moments should leave the normal layout and move into a dedicated cinematic state.

### What should define DEADWILL

- Large sealed object as the emotional center.
- Premium black material with gold edge logic.
- Violet atmospheric layer behind interaction surfaces.
- Distinct “ritual purchase” step before reveal.
- Clear balance, clear price, clear result, clear transfer status.

## 2. Colors and Materials To Use

### Best palette direction

- Base blacks: `#070707`, `#0B0B10`, `#171724`, `#211333`
- Premium gold: `#D6A84F`, `#F2C76B`, `#8A6228`
- Violet atmosphere: deep desaturated purple, not neon
- Win green only as a small status/reward accent: `#36D98D`
- Danger red only for cursed states: `#B3293A`, `#6E101B`

### Material conclusions

- Obsidian glass for UI shells.
- Layered smoke, dust and low-opacity particles in backgrounds.
- Metallic gold edge-light, not flat gold fills everywhere.
- Internal card lighting near top corners.
- Paper texture and sealed wax logic for contracts and result documents.
- Strong vignette and ambient spotlighting around focal objects.

## 3. Competitor / Reference Screens Done Better

### Home / wallet top section

Fintech references consistently do these better:

- bold balance display
- short quick actions
- minimal vertical waste
- crisp hierarchy between profile, balance and main CTA

### Game loop / reward

Casino/game references do these better:

- making the main gameplay object physically dominant
- using a single powerful CTA
- turning reward reveal into a visual event instead of inline feedback

### Battle pass

Battle pass references do these better:

- dual reward lanes with obvious lock / claim / owned states
- a more collectible, progression-heavy layout
- premium CTA integrated into the screen instead of floating randomly

### Leaderboard / clan

Leaderboard references do these better:

- top 3 ranking emphasis
- easier scanning of rank / avatar / name / score
- more visual separation between podium and normal rows

### NFT / marketplace

NFT references do these better:

- artwork-first cards
- rarity signaling
- product-like card composition instead of generic list tiles

## 4. Ideas To Transfer Into DEADWILL Screens

### Home

- One dominant hero object occupying the upper half.
- Balance and avatar in a compact premium header.
- Two strong mode cards directly under hero.
- Secondary systems shown as rich strips/panels, not plain stacked stats.

### Play

- Game board must look like a dedicated ritual space.
- 5 contracts arranged compositionally, not as generic grid cards.
- Purchase step should be visually separate and ceremonial.
- Outcome categories should be icon-like pills, not plain text chips.

### Shop

- Coin packs and NFTs should use large artwork regions.
- Premium offer should feel like a membership/black card product.
- Transfer center should inherit marketplace visual language, not look like back-office status tables.

### Clans

- My clan hero card should feel like a guild emblem showcase.
- Top-3 members should be visually podium-like.
- Chat needs stronger message bubble styling and system-event highlighting.

### Pass

- Should feel like a season ledger / progression board.
- Reward cells should be collectible and tactile.
- Premium lane needs higher ornamentation than free lane.

### Profile

- Identity card should feel like a black metal membership card.
- Menu rows should feel like navigation surfaces, not raw setting list items.

## 5. Errors Not To Repeat

- No SaaS dashboard layout rhythm.
- No equal visual weight for every block.
- No generic stat cards pretending to be “game UI”.
- No thin typography on dark textured backgrounds.
- No flat empty black areas without atmospheric purpose.
- No list-first contract screen.
- No small modal for the most emotional moment in the game.
- No NFT list that looks like a spreadsheet.
- No clan leaderboard that looks like a table export.

## 6. Concrete Fixes Required In Current DEADWILL UI

### High priority

1. Make the home hero larger, richer and more cinematic.
2. Compress the top header so it behaves more like a Telegram game shell.
3. Replace current contract cards with more envelope-like silhouettes and stronger material contrast.
4. Make the play board less rectangular and more scene-like.
5. Increase separation between buy step and choose step.
6. Make result overlay more outcome-specific.
7. Push shop cards toward artwork-dominant marketplace composition.
8. Upgrade pass track from “functional” to “collectible”.
9. Give clan screen a podium and stronger guild identity.
10. Make profile feel like a membership card plus sections, not a utility view.

### Medium priority

11. Add richer empty states for transfer / NFT / history.
12. Add skeleton/loading overlays for purchase/reveal flows.
13. Add more micro-motion in hero, contract idle and active states.
14. Tighten bottom nav to look more like a luxury dock and less like a standard footer.

## Design To-Do

- `[ ]` redesign tokens: spacing, radii, typography, glow, glass layers
- `[ ]` redesign header into tighter Telegram game header
- `[ ]` rebuild home hero with richer envelope scene and better depth
- `[ ]` redesign cheap will card to feel more “entry ritual” and less generic
- `[ ]` redesign premium will card to feel much rarer and more dangerous
- `[ ]` rebuild contract board with more physical envelope shapes
- `[ ]` improve buy step / armed step hierarchy
- `[ ]` redesign reveal overlay by outcome type
- `[ ]` redesign result state for empty / debt / multiplier individually
- `[ ]` rebuild battle pass as a collectible ledger track
- `[ ]` rebuild clan ranking with podium and clearer hierarchy
- `[ ]` rebuild NFT marketplace cards with stronger art areas
- `[ ]` redesign transfer center into premium status flow
- `[ ]` redesign profile into identity-first premium dashboard
- `[ ]` add empty states, loading states, and motion pass
- `[ ]` final visual audit against “not SaaS / not admin / not cheap”

## Immediate Direction For Next UI Pass

1. Focus first on `Home + Play + Reveal + Result`.
2. Only after those four feel premium enough, bring same quality to `Shop`.
3. Then upgrade `Pass`, `Clans`, `Profile`.
4. Final pass: loading, empty states, polish, motion consistency.
