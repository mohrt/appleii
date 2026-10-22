# Apple II in the browser

**Play it at [mohrt.github.io/appleii](https://mohrt.github.io/appleii/)**

An Apple IIe emulator written from scratch in TypeScript. It has:

- **CPU:** the enhanced IIe's 65C02, or the original IIe's NMOS 6502 with its undocumented opcodes, chosen by the ROM. Both pass Klaus Dormann's functional tests and a sample of Tom Harte's SingleStepTests for every opcode, cycle counts included.
- **Memory:** 64K of main RAM and the extended 80-column card's 64K of auxiliary RAM, with the IIe's MMU soft switches (80STORE, RAMRD, RAMWRT, ALTZP, the internal and slot ROMs) and the language card's 16K.
- **Video:** 40- and 80-column text with the video ROM's characters, flashing and MouseText; lo-res, hi-res, double lo-res and double hi-res; mixed mode; and mode changes mid-frame. In colour, each dot gets the colour the NTSC signal of its neighbours makes, which gives the artifact colours and their fringes. Green, amber and white monitors too. Programs can read the vertical blank and the "floating bus".
- **Disk II:** two drives on a controller in slot 6, read and written bit by bit through the controller's shift register, so copy-protected disks in WOZ format work. The head steps in quarter tracks.
- **Sound:** the speaker, and a Mockingboard in slot 4 (two AY-3-8910s and their 6522 VIAs, whose timers drive the music) in stereo.
- **Everything else:** the keyboard, a joystick (analogue, from a gamepad's stick, or from keys) and its two buttons.

Drop a `.dsk`, `.do`, `.po`, `.nib`, `.woz` or `.2mg` disk image, or a `.zip` of them, onto the page to put it in a drive.

## Keys and controllers

- **Keyboard:** keys type on the Apple as labelled. Caps Lock is on to begin with, as most Apple II software wants capitals; the Caps Lock key (or the checkbox) switches it. Left Alt (Option) is Open Apple and Right Alt is Closed Apple. Ctrl+F12 is Ctrl-Reset, and Open Apple with it restarts the Apple. The Cmd key stays with the browser.
- **Joystick:** a gamepad works without taking any keys: its left stick moves the joystick as the Apple's analogue one would, the D-pad pushes it all the way, and the face buttons are the two buttons. Keys can be the joystick too: the numpad, the arrow keys with Space, or W A S D with F. Keys used by the joystick don't type on the Apple, so set it back to No keys for typing.

## The machine

The toolbar has pause, Ctrl-Reset, Restart (off and on again, which boots the disk in drive 1), full screen, **System ROMs...**, the monitor (colour, green, amber or white) and the Mockingboard. Save states keep the whole Apple, disks included, in the browser, and can be exported and imported as `.a2state` files. A state only loads with the ROMs it was saved with.

## ROMs

No ROM or game files are included in this repository.

The Apple IIe's ROMs are still under copyright, so the site never serves them. On the first visit the page shows a setup panel in place of the screen, asking for three:

- **The IIe ROM** (16K): Applesoft BASIC, the Monitor and the built-in firmware, as one file or the two 8K chips it comes as. The enhanced IIe's runs the most software; the original IIe's works too, on an NMOS 6502.
- **The video ROM** (4K), the characters on the screen.
- **The Disk II ROM** (256 bytes), the disk controller's boot ROM.

The panel recognises Apple's chips by checksum, and takes a whole ROM collection or a zip of them too. AppleWin keeps them as `Apple2e_Enhanced.rom`, `Apple2e_Enhanced_Video.rom` and `DISK2.rom` in its [`resource`](https://github.com/AppleWin/AppleWin/tree/master/resource) folder. The ROMs are kept in the browser's IndexedDB, with persistent storage requested, so later visits start straight away. **System ROMs...** in the toolbar changes or forgets them.

## Disks

Sector images (`.dsk`, `.do`, `.po`) are laid out on their tracks as DOS 3.3 formats them; `.dsk` files in ProDOS order are recognised. `.nib` images keep their own bytes, and WOZ images (1 and 2) their exact bits, copy protection included. Several files dropped or chosen at once, or a zip holding several disks, give each drive a **Swap disk** menu for changing disks during a game.

Your disk images are never changed. What games write to a disk is kept in the browser and put back whenever that image is inserted again. **Revert** forgets it, and **Download** gives you the disk as it is now, in its own format. **New blank disk** makes an empty disk for games that want a save disk of their own; format it from the game, with DOS 3.3's `INIT` or from ProDOS.

**Fast loading** runs the Apple flat out while the drive is reading or writing, and the sound is skipped meanwhile.

## Free games

`npm run fetch:games` downloads the freely licensed games listed in `scripts/games-catalog.json` into `public/games/`, where they appear in a "Free games" picker. Each entry has its credit, licence, source and checksum. To offer other games, list them in `public/games/index.json` the same way: `{ "games": [{ "title": "Some Game", "file": "some-game.dsk" }] }`.

## Not covered

Apple II and II Plus ROMs (this is a IIe), the IIc, 3.5" disks and hard drives, the mouse, the serial and parallel cards, the clock card, and the Mockingboard's speech chip.

## Development

```sh
npm install
npm run fetch:games      # optional: free games into public/games/
npm run dev              # http://localhost:5173
npm test                 # tests needing downloaded files or your ROMs skip when they're missing
npm run fetch:cpu-tests  # optional: Dormann's tests and a sample of the 65x02 SingleStepTests
```

The tests that boot the Apple use your own ROMs, put in `roms/` (never committed) under AppleWin's names: `Apple2e_Enhanced.rom`, `Apple2e.rom`, `Apple2e_Enhanced_Video.rom` and `DISK2.rom`. `npm test` also boots the free games and any disk images you put in `disks/`; `SHOTS=/tmp/shots npm test` saves screenshots of them.

## Deploying

`.github/workflows/pages.yml` downloads the free games and the CPU tests, tests and builds the site, and deploys it to GitHub Pages on every push to `main` (Pages source: "GitHub Actions").
