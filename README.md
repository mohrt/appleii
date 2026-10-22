# Apple II in the browser

**Play it at [mohrt.github.io/appleii](https://mohrt.github.io/appleii/)**

An Apple II, Apple II Plus, Apple IIe and Apple IIc emulator written from scratch in TypeScript. It has:

- **Machines:** the Apple II (1977, Integer BASIC), the Apple II Plus (1979, Applesoft), the Apple IIe (1983) and the Apple IIc (1984), chosen in Machine setup. The II and II Plus have 48K and a 16K language card in slot 0, and type only in capitals. The IIc is a IIe without slots: its ports' firmware is always in, the 32K ROMs (0, 3 and 4) switch banks, its IWM disk controller answers the ROM's checks, and its vertical blank is a flag that $C070 clears.
- **CPU:** the enhanced IIe's and the IIc's 65C02, or the NMOS 6502 with its undocumented opcodes (the II, the II Plus and the original IIe). Both pass Klaus Dormann's functional tests and a sample of Tom Harte's SingleStepTests for every opcode, cycle counts included.
- **Memory:** 64K of main RAM and the extended 80-column card's 64K of auxiliary RAM, with the IIe's MMU soft switches (80STORE, RAMRD, RAMWRT, ALTZP, the internal and slot ROMs) and the language card's 16K.
- **Video:** 40- and 80-column text with the video ROM's characters, flashing and MouseText (the II and II Plus: 40 columns of capitals); lo-res, hi-res, double lo-res and double hi-res; mixed mode; and mode changes mid-frame. In colour, each dot gets the colour the NTSC signal of its neighbours makes, which gives the artifact colours and their fringes. Green, amber and white monitors too. Programs can read the vertical blank and the "floating bus".
- **Disk II:** two drives on a controller in slot 6, read and written bit by bit through the controller's shift register, so copy-protected disks in WOZ format work. The head steps in quarter tracks.
- **Sound:** the speaker, and a Mockingboard in slot 4 (two AY-3-8910s and their 6522 VIAs, whose timers drive the music) in stereo. The IIc has no slots, so no Mockingboard.
- **Everything else:** the keyboard, a joystick (analogue, from a gamepad's stick, or from keys) and its two buttons.

Drop a `.dsk`, `.do`, `.po`, `.nib`, `.woz` or `.2mg` disk image, or a `.zip` of them, onto the page to put it in a drive.

## Keys and controllers

- **Keyboard:** keys type on the Apple as labelled. On the IIe, Caps Lock is on to begin with, as most Apple II software wants capitals; the Caps Lock key (or the checkbox) switches it. The II and II Plus only have capitals. Left Alt (Option) is Open Apple and Right Alt is Closed Apple. Ctrl+F12 is Ctrl-Reset, and Open Apple with it restarts the Apple. The Cmd key stays with the browser.
- **Joystick:** a gamepad works without taking any keys: its left stick moves the joystick as the Apple's analogue one would, the D-pad pushes it all the way, and the face buttons are the two buttons. Keys can be the joystick too: the numpad, the arrow keys with Space, or W A S D with F. Keys used by the joystick don't type on the Apple, so set it back to No keys for typing.

## The machine

The toolbar has pause, Ctrl-Reset, Restart (off and on again, which boots the disk in drive 1), full screen, **Machine setup...**, the monitor (colour, green, amber or white) and the Mockingboard. Machine setup chooses the Apple II, II Plus, IIe or IIc and takes their ROMs; changing it restarts the Apple. The original Apple II has no autostart: it starts in the Monitor, where `C600G` and Return boot the disk in drive 1.

Save states keep the whole Apple, disks included, in the browser, and can be exported and imported as `.a2state` files. A state only loads with the ROMs it was saved with; one from another model switches to it.

## ROMs

No ROM or game files are included in this repository.

Apple's ROMs are still under copyright, so the site never serves them. On the first visit the page shows a setup panel in place of the screen: choose the machine, then give its ROMs.

| Machine | Main ROM | Characters | Disk |
|---|---|---|---|
| Apple IIe | 16K: Applesoft, the Monitor and the built-in firmware (one file or its two 8K chips). The enhanced IIe's runs the most software; the original IIe's works too, on an NMOS 6502. | the 4K video ROM | the Disk II ROM (256 bytes) |
| Apple IIc | 16K for the first IIc, or 32K for ROM 0, 3 or 4 | the same 4K video ROM | in its own ROM |
| Apple II Plus | 12K: Applesoft and the Autostart Monitor | the 2K character ROM | the Disk II ROM |
| Apple II | 12K: Integer BASIC and the original Monitor | the 2K character ROM | the Disk II ROM |

The panel recognises Apple's chips by checksum, and takes a whole ROM collection or a zip of them too. Each model's ROMs are kept, so switching models doesn't mean loading them again. AppleWin keeps all but the IIc's as `Apple2e_Enhanced.rom`, `Apple2e_Enhanced_Video.rom`, `Apple2_Plus.rom`, `Apple2.rom`, `Apple2_Video.rom` and `DISK2.rom` in its [`resource`](https://github.com/AppleWin/AppleWin/tree/master/resource) folder. The ROMs are kept in the browser's IndexedDB, with persistent storage requested, so later visits start straight away. **Machine setup...** in the toolbar changes or forgets them.

## Disks

Sector images (`.dsk`, `.do`, `.po`) are laid out on their tracks as DOS 3.3 formats them; `.dsk` files in ProDOS order are recognised. `.nib` images keep their own bytes, and WOZ images (1 and 2) their exact bits, copy protection included. Several files dropped or chosen at once, or a zip holding several disks, give each drive a **Swap disk** menu for changing disks during a game.

Your disk images are never changed. What games write to a disk is kept in the browser and put back whenever that image is inserted again. **Revert** forgets it, and **Download** gives you the disk as it is now, in its own format. **New blank disk** makes an empty disk for games that want a save disk of their own; format it from the game, with DOS 3.3's `INIT` or from ProDOS.

**Fast loading** runs the Apple flat out while the drive is reading or writing, and the sound is skipped meanwhile.

## Free games

`npm run fetch:games` downloads the freely licensed games listed in `scripts/games-catalog.json` into `public/games/`, where they appear in a "Free games" picker. Each entry has its credit, licence, source and checksum, and the oldest machine it runs on (`requires`: `ii`, `iiplus`, `iie` or `enhanced-iie`); the picker only offers the games the machine in use can run. To offer other games, list them in `public/games/index.json` the same way: `{ "games": [{ "title": "Some Game", "file": "some-game.dsk", "requires": "iie" }] }`.

| Runs on | Games |
|---|---|
| All of them, from the Apple II | Escape, Fujirun, Million Perfect Letters, Totally |
| The II Plus and IIe | Deflection, Kaverns of KFest, Light Cycles 3D, Painter, Tom Bombem |
| The IIe | A2Bejwld, Flapple Bird, Froggo, Moria8 |
| The enhanced IIe and the IIc | Apple2048 |

## Not covered

The IIc Plus and the IIgs, the IIc's mouse and serial ports, 13-sector (DOS 3.2) disks, 3.5" disks and hard drives, the mouse, the serial and parallel cards, the clock card, and the Mockingboard's speech chip.

## Development

```sh
npm install
npm run fetch:games      # optional: free games into public/games/
npm run dev              # http://localhost:5173
npm test                 # tests needing downloaded files or your ROMs skip when they're missing
npm run fetch:cpu-tests  # optional: Dormann's tests and a sample of the 65x02 SingleStepTests
```

The tests that boot the Apple use your own ROMs, put in `roms/` (never committed) under AppleWin's names: `Apple2e_Enhanced.rom`, `Apple2e.rom`, `Apple2e_Enhanced_Video.rom`, `Apple2_Plus.rom`, `Apple2.rom`, `Apple2_Video.rom` and `DISK2.rom`, and the IIc's as `Apple2c_rom0.rom`, `Apple2c_rom3.rom` and `Apple2c_rom4.rom`. `npm test` also boots the free games (on the enhanced IIe, the IIc and the oldest machine each says it runs on) and any disk images you put in `disks/`; `SHOTS=/tmp/shots npm test` saves screenshots of them.

## Deploying

`.github/workflows/pages.yml` downloads the free games and the CPU tests, tests and builds the site, and deploys it to GitHub Pages on every push to `main` (Pages source: "GitHub Actions").
