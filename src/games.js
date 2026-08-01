/**
 * The games menu.
 *
 * ICQ shipped games you launched against a contact — the Launch section of a
 * contact's right-click menu offered RPS Online, Slide-a-lama and Sumo
 * Volleyball, and Xtraz added more later. Almost all of them were Flash or ran
 * over OSCAR's peer-to-peer rendezvous, and both of those are gone: Flash died
 * in 2020, and ICQ's OSCAR servers shut down in June 2024.
 *
 * What survives is the handful that were rebuilt for the web. Those are linked
 * here. The rest are listed in docs/FORMATTING-BACKGROUNDS-GAMES.md as dead,
 * so nobody goes looking twice.
 *
 * Two of these are the originals in a real sense: Slide-A-Lama and Zoopaloola
 * were both MLiven/Redboss titles that ICQ carried, and both have been rebuilt
 * by their makers for the browser.
 *
 * This list lives in its own module because it was previously duplicated in
 * ChatWindow.js and Sidebar.js, which is the kind of copy that quietly drifts.
 */

const GAMES = [
  {
    id: 'lama',
    name: 'Slide-A-Lama',
    icon: '🦙',
    url: 'https://slidealama.eu/',
    note: 'The original ICQ title, rebuilt for the browser by its makers.',
  },
  {
    id: 'zoopaloola',
    name: 'Zoopaloola',
    icon: '🐘',
    url: 'https://zoopaloola.eu/',
    note: 'The other MLiven/Redboss game ICQ carried, also rebuilt.',
  },
  {
    id: '8ball',
    name: '8 Ball Pool',
    icon: '🎱',
    url: 'https://bloob.io/de/8ballpool',
    // No web version of ICQ's own pool game survives; this stands in for it.
    note: 'A stand-in — ICQ\'s own pool game has no surviving web version.',
  },
];

export default GAMES;
export { GAMES };
