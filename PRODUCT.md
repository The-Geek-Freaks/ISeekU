# ISeekU

## Register

**Brand** for the project page and README — design *is* the product there, because
what the page has to prove is that the recreation is faithful. A screenshot of
a Windows 98 contact list does more work than any sentence about fidelity.

**Product** for the application itself, where design serves the product and the
product's design was fixed in 1999. Inside the app, taste means accuracy: the
right grey, the right row height, the right words in the right menu. Every
visual decision there is settled by `docs/ORIGINAL-REFERENCE.md`, not by
preference.

## What it is

ISeekU is ICQ, rebuilt. It speaks XMPP to the icqr.net network, carries
WhatsApp and Telegram alongside, and unlocks direct peer-to-peer features —
file transfer with no size limit, calls, games — when the Contact on the other
end is also running ISeekU.

It ships as two switchable eras, both inside the native OS window frame rather
than a self-drawn one: `icq99` (Windows 98 chrome, 16-pixel rows, navy
selection) and `icq78` (the ICQ 7 green, 31-pixel rows). Skins people made
twenty years ago load — all three of ICQ's skinnable formats.

## Who it is for

People who used ICQ and remember it precisely. They are not looking for a
messenger; they have one. They are looking for the specific thing they lost,
and they will notice a wrong shade of grey, a row that is four pixels too tall,
or a menu item worded differently than it was. The audience skews German —
ICQ's largest market, and the reason the reference screenshots and imported
skins are mostly German.

Secondary: people who find the reconstruction itself interesting — the file
formats reverse-engineered, the protocol measured off a live client.

## Brand personality

**Precise, plain-spoken, unsentimental about its own nostalgia.**

The project earns its emotional pull by being *accurate*, not by talking about
how much everyone misses ICQ. It states what it measured and where it measured
it. It says plainly what does not work — the server is unencrypted, imported
skins carry colours but not bitmaps, "peer to peer with no relay" is untrue for
users behind symmetric NAT.

The voice is a restoration report, not marketing. Nothing is "revolutionary" or
"seamless". Things are measured, or they are honestly unknown.

## Anti-references

- **Any modern messenger's landing page.** Gradient hero, floating phone
  mockup, three feature cards with line icons, "Start chatting in seconds".
  ISeekU's whole claim is that it is *not* one of those.
- **Nostalgia pastiche.** Comic Sans, Windows 95 clip-art, a fake CRT scanline
  filter, `<marquee>`. Treating the era as a costume rather than a
  specification. The original was designed by people being serious; imitating
  it badly is the disrespect.
- **Retro-terminal / synthwave.** The neon-grid, magenta-and-cyan, VHS-glitch
  family. It is the reflex "retro" aesthetic and has nothing to do with what
  ICQ actually looked like, which was grey.
- **A README that is a wall of badges.** Twelve shields, then a table of
  contents, then installation instructions before anyone has seen the thing.

## Strategic design principles

1. **Show it before describing it.** The screenshots are the argument. They are
   generated from the running application by `e2e/screenshots.spec.js`, so they
   cannot go stale or flatter.

2. **Accuracy is the aesthetic.** Palette comes from measured values —
   `#c0c0c0` because that is `COLOR_3DFACE`, `#000080` because Windows 98's
   selection was navy and not XP's `#316AC5`. The flower's petals are
   `#00FF00`, measured off the 2001b splash screen, after a first attempt took
   them from the 2006 website palette and was wrong.

3. **Modern setting, period subject.** The page renders the era faithfully
   *inside* a contemporary layout: real type hierarchy, generous space, works
   on a phone. The 1999 material is the content, not the container. A page that
   is itself a Windows 98 window is a costume, and unreadable at 375px.

4. **Every honest limit is stated where someone meets it**, not buried in a
   FAQ. The unencrypted-server warning is in the release notes, the README, and
   the application itself, because a person who signs in without knowing is
   materially harmed.

5. **German where German is the truth.** Screenshots, skin names and the
   reference material are German because that is where ICQ lived. The interface
   and code are English.

## Accessibility

Contrast is a hard requirement and is where period accuracy and legibility
collide. Windows 98's own grey-on-grey disabled text fails modern contrast
rules. Resolution: reproduce the era exactly inside the application chrome,
where it is a faithful rendering of a historical artefact, but never let the
project page inherit it — page body text meets 4.5:1 against its background,
always. Keyboard reachability and visible focus are not negotiable in either.
