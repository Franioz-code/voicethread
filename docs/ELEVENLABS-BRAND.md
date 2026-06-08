# VoiceThread — ElevenLabs brand spec (single source of truth)

Goal: make VoiceThread feel like a product **ElevenLabs themselves shipped**.
Researched from elevenlabs.io, /brand, and the published ElevenLabs design system.
Every design agent MUST build to these tokens. Default mode = **LIGHT (editorial)**;
dark tokens are included so we can flip later.

## Brand principles (what makes it read as "ElevenLabs")
- **Monochrome-first.** Black `#000` / white `#fff` + a **warm "stone" neutral** scale. No saturated UI colors. Primary CTA is ink `#292524`, never a bright color.
- **Editorial minimalism.** Generous whitespace, hairline borders, high contrast, calm hierarchy. Few elements, perfectly spaced.
- **Signature pastel gradient orbs** (mint/peach/lavender/sky/rose) used ONLY as soft atmospheric blooms behind hero/wordmark or inside "orb cards" — never as button fills, text, or card backgrounds.
- **Audio motif.** Subtle waveform as the product's visual signature.
- **The "11" mark.** Two simple vertical bars. Minimal clearance = its height. Never recreate with letters/numerals; no shadows/strokes/rotation.
- **Type:** Inter for everything; display = Inter **Light (300)** at **negative tracking**; body = regular with slight **positive** tracking. (ElevenLabs' display face Waldenburg is licensed — Inter Light + tight tracking is the faithful, legal stand-in.)

## Color tokens (LIGHT — default)
| token | hex | use |
|---|---|---|
| canvas | `#f5f5f5` | app background |
| canvasSoft | `#fafafa` | secondary background |
| surface | `#ffffff` | cards, inputs, bubbles |
| surfaceStrong | `#f0efed` | chips, badges, voice-icon bg |
| ink | `#0c0a09` | strongest text, primary-active |
| primary | `#292524` | primary CTA fill, body-strong text |
| body | `#4e4e4e` | body text |
| muted | `#777169` | secondary text |
| mutedSoft | `#a8a29e` | tertiary/placeholder |
| onPrimary | `#ffffff` | text on ink/primary |
| hairline | `#e7e5e4` | borders/dividers |
| hairlineSoft | `#f0efed` | subtle dividers |
| hairlineStrong | `#d6d3d1` | input borders, outline buttons |
| success | `#16a34a` | success only |
| error | `#dc2626` | error only |

## Color tokens (DARK — for later flip)
canvas `#0c0a09`, surface `#1c1917`, surfaceStrong `#292524`, text `#ffffff`, textSoft `#a8a29e`, hairline `#292524`, primary `#ffffff` (ink-on-light inverts to light-on-dark), onPrimary `#0c0a09`.

## Gradient orbs (signature, decorative only)
mint `#a7e5d3` · peach `#f4c5a8` · lavender `#c8b8e0` · sky `#a8c8e8` · rose `#e8b8c4`
Render as soft radial blooms (low opacity, large blur feel) behind the wordmark / hero, or inside a 24px-radius "orb card". Never functional.

## Typography (Inter)
Load Inter via `@expo-google-fonts/inter` + `expo-font`. Approximate the ElevenLabs scale:

| token | size | weight | line-height | letter-spacing | font |
|---|---|---|---|---|---|
| displayLg | 34 | 300 | 1.1 | -0.6 | Inter_300Light |
| displayMd | 28 | 300 | 1.13 | -0.4 | Inter_300Light |
| displaySm | 22 | 300 | 1.2 | -0.2 | Inter_300Light |
| titleMd | 20 | 500 | 1.35 | 0 | Inter_500Medium |
| titleSm | 18 | 500 | 1.44 | 0.18 | Inter_500Medium |
| body | 16 | 400 | 1.5 | 0.16 | Inter_400Regular |
| bodyStrong | 16 | 500 | 1.5 | 0.16 | Inter_500Medium |
| bodySm | 15 | 400 | 1.47 | 0.15 | Inter_400Regular |
| caption | 14 | 400 | 1.5 | 0 | Inter_400Regular |
| overline | 12 | 600 | 1.4 | 0.96 (UPPERCASE) | Inter_600SemiBold |
| button | 15 | 500 | 1.0 | 0 | Inter_500Medium |

Display tracking is NEGATIVE; body tracking is slightly POSITIVE — this is a key ElevenLabs tell.

## Spacing (4px base)
xxs 4 · xs 8 · sm 12 · base 16 · md 20 · lg 24 · xl 32 · xxl 48 · section 64

## Radius
xs 4 · sm 6 · md 8 (inputs) · lg 12 · xl 16 (cards) · xxl 24 (orb cards) · pill 9999 (CTAs, badges, voice icons, avatars)

## Elevation
Cards: 1px `hairline` border + very soft shadow only when raised: `rgba(0,0,0,0.04)` blur ~16. Mostly **flat** — rely on hairlines, not shadows.

## Component recipes (mobile)
- **Primary CTA (pill):** bg `primary #292524`, text `onPrimary`, 15/500, radius pill, height 48–52 (mobile-comfortable), pressed → `ink #0c0a09`.
- **Outline button:** transparent, 1px `hairlineStrong`, text `ink`, radius pill.
- **Text button:** transparent, text `ink`, 15/500.
- **Input:** bg `surface`, 1px `hairlineStrong`, radius md (8), padding 12×16, min height 44; focus → 2px `ink`.
- **Card:** bg `surface`, 1px `hairline`, radius xl (16), padding lg (24).
- **Badge / chip pill:** bg `surfaceStrong`, text `ink`, overline type, radius pill, padding 4×10. Selected chip → bg `ink`, text `onPrimary`.
- **Voice row:** transparent, hairline divider, 12px vertical padding, 32px circular voice icon (`surfaceStrong` bg).
- **Chat bubble (incoming):** bg `surface`, ink text, radius 16 (tight corner near tail). **Outgoing:** bg `ink #0c0a09`, `onPrimary` text. (Monochrome bubbles = on-brand; NOT iMessage blue.)
- **Tabs:** minimal — text 15/500, active = ink with a 1px underline or a subtle `surfaceStrong` pill; inactive = `muted`.
- **Header / wordmark:** "VoiceThread" set in Inter Light, tight tracking, with the "11" bars motif or a small waveform; status as `overline`/`caption` in `muted`.

## Do / Don't
- ✅ Ink CTAs, hairline borders, lots of canvas, pastel orbs as atmosphere, Inter light display.
- ❌ Saturated buttons (no blue/green CTAs), heavy shadows, gradient text/buttons, recreating "11" with letters, cramped spacing, multiple accent colors.

## Wordmark note
App is "VoiceThread" (not an official ElevenLabs product). Present it in the ElevenLabs *visual language* (type, spacing, monochrome, optional "11"/waveform motif) — an homage, not a claim of official affiliation. Keep a subtle "powered by ElevenLabs" framing where natural.
