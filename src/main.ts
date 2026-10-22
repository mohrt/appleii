import { AudioOutput } from './audio/audio-output';
import { CLOCK_HZ, isIIcModel, type Model } from './apple2';
import { FloppyDisk } from './disk/floppy';
import { STATE_EXTENSION, filesFrom, firstDisk, readMedia, titleFromFileName } from './disk/load';
import { Emulator } from './emulator';
import { fetchGame, loadGameManifest, runsOn, type BundledGame, type Machine } from './games';
import { GamepadManager, padName, readGamepad } from './io/gamepad-input';
import { Joystick } from './io/joystick';
import { AppleKeyboard, type KeySetName } from './io/keyboard';
import { SCREEN_ASPECT, Screen } from './render/screen';
import { SystemRomStore, hasRequiredRoms, machineRoms, modelName, romsCrc, type StoredRom, type SystemRoms } from './roms/system-roms';
import { DiskSaves, type DiskSaveRecord, type SaveDiskRecord } from './storage/disk-saves';
import { SaveStates, decodeSession, encodeSession, type SaveStateRecord, type Session } from './storage/save-states';
import { memoryStores, openBrowserStores, type KeyValueStore } from './storage/store';
import { DiskPanel } from './ui/disk-panel';
import { downloadFile } from './ui/download';
import { askForMachine } from './ui/rom-setup';
import { JsonRecord, Settings } from './ui/settings';
import { attachToolbar } from './ui/toolbar';
import type { Monitor } from './video/video';

/** Form fields whose values are remembered between visits. */
const REMEMBERED_SETTINGS = ['monitor', 'mockingboard', 'joystick-keys', 'joystick-pad', 'caps-lock', 'warp', 'sound', 'volume'];

/** How often games' saves to their disks are written to browser storage. */
const DISK_SAVE_INTERVAL_MS = 2000;
const DRIVES = 2;

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Page is missing ${selector}`);
  return element;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'apple-ii';

/** A line about a disk: what kind of image it is. */
function describeDisk(disk: FloppyDisk): string {
  const kind = {
    dos: 'DOS-order disk image',
    prodos: 'ProDOS-order disk image',
    nib: 'nibble image',
    woz: 'WOZ image (copy protection included)',
  }[disk.format];
  return disk.writeProtected ? `${kind}, write-protected` : kind;
}

async function main(): Promise<void> {
  const canvas = requireElement<HTMLCanvasElement>('#screen');
  const status = requireElement<HTMLParagraphElement>('#status');
  const screenFrame = requireElement<HTMLElement>('.screen-frame');
  const romSetup = requireElement<HTMLElement>('#rom-setup');
  document.documentElement.style.setProperty('--screen-aspect', SCREEN_ASPECT.toFixed(4));

  try {
    const settings = new Settings();
    settings.bind(document, REMEMBERED_SETTINGS);

    // --- ROMs ------------------------------------------------------------------------
    let storageWorks = true;
    const stores = await openBrowserStores(() => {
      status.textContent = "Waiting for the browser's storage: if this Apple II is open in another tab, close or reload that tab.";
    }).catch((error: unknown) => {
      console.warn('Browser storage is unavailable; saves will last until the page is closed.', error);
      storageWorks = false;
      return memoryStores();
    });
    if (!storageWorks) {
      requireElement<HTMLElement>('.rom-storage-note').textContent =
        "This browser isn't letting the page store files, so the ROMs will be forgotten when you close it.";
    }
    const romStore = new SystemRomStore(stores.systemRoms as KeyValueStore<StoredRom>);
    const machineRecord = new JsonRecord<{ model: Model }>('appleii-machine');
    let model: Model = machineRecord.read().model ?? 'iie';
    let systemRoms: SystemRoms = await romStore.load();
    if (!hasRequiredRoms(systemRoms, model)) {
      status.textContent = 'Load the ROMs above to switch the Apple on.';
      const setup = await askForMachine(romSetup, romStore, systemRoms, { model });
      if (!setup) throw new Error('No ROMs.');
      ({ model, roms: systemRoms } = setup);
      machineRecord.write({ model });
    }
    let roms = machineRoms(systemRoms, model);

    // --- The machine -----------------------------------------------------------------
    const screen = new Screen(canvas);
    const emulator = new Emulator(roms, model, screen);
    const apple = emulator.apple;
    const audio = await AudioOutput.create().catch((error: unknown) => {
      console.warn('Audio is unavailable:', error);
      return null;
    });
    apple.audio.setRates(CLOCK_HZ, audio?.sampleRate ?? 48_000);

    let paused = false;
    /** While the ROM setup is open over the running Apple. */
    let changingRoms = false;
    const focusScreen = () => canvas.focus();

    /** The machine as the free games know it: the enhanced IIe is told from the original by its ROM. */
    const machine = (): Machine => (isIIcModel(model) || (model === 'iie' && apple.enhanced) ? 'enhanced-iie' : model);

    const updateStatus = () => {
      const parts = [modelName(model, roms.main), apple.enhanced ? '65C02' : '6502', apple.hasMmu ? '128K' : '64K'];
      if (apple.hasMockingboard) parts.push('Mockingboard');
      status.textContent = parts.join(' · ');
    };

    const powerCycle = () => {
      apple.powerOn();
      apple.audio.resync(apple.cycles);
      emulator.resetTiming();
      audio?.flush();
      if (model === 'ii') diskPanel.showMessage('The Apple II starts in its Monitor: type C600G and Return to boot the disk in drive 1.', true);
      else if (!apple.disk2.drives[0].disk) diskPanel.showMessage('No disk in drive 1: the Apple waits for one. Insert a disk, or press Ctrl-Reset for BASIC.', true);
    };

    const ctrlReset = () => {
      apple.reset();
      audio?.flush();
      diskPanel.showMessage('');
    };

    // --- Disks and their saves -------------------------------------------------------
    const diskSaves = new DiskSaves(
      stores.diskSaves as KeyValueStore<DiskSaveRecord>,
      stores.saveDisks as KeyValueStore<SaveDiskRecord>,
    );
    /** The names shown for the disks in the drives (also used to label save states). */
    const diskLabels: (string | null)[] = [null, null];
    const refreshSaveDisks = async () => diskPanel.setSaveDisks(await diskSaves.listSaveDisks());

    /** Stores what games have written to a drive's disk. */
    const persistDisk = async (drive: number) => {
      const disk = apple.disk2.drives[drive].disk;
      if (!disk || !disk.dirty) return;
      await diskSaves.persist(drive, disk);
      if (diskSaves.origin(drive)?.kind === 'image') diskPanel.setSavedChanges(drive, true);
    };
    const persistAll = () => Promise.all([0, 1].map((drive) => persistDisk(drive)));
    setInterval(() => {
      // Wait for the motor to stop, so a sector being written is finished.
      if (apple.disk2.spinning(apple.cycles)) return;
      void persistAll().catch((error: unknown) => console.warn('Could not keep the disk:', error));
    }, DISK_SAVE_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void persistAll();
    });
    window.addEventListener('pagehide', () => void persistAll());

    const showDisk = (drive: number, disk: FloppyDisk, label: string, hasSavedChanges: boolean) => {
      apple.insertDisk(drive, disk);
      diskLabels[drive] = label;
      diskPanel.showDisk(drive, label, describeDisk(disk), hasSavedChanges);
      if (drive === 0) diskPanel.showMessage('');
    };

    const eject = (drive: number) => {
      void persistDisk(drive).then(() => {
        diskSaves.eject(drive);
        apple.insertDisk(drive, null);
        diskLabels[drive] = null;
        diskPanel.showEmpty(drive);
      });
    };

    // --- Save states -----------------------------------------------------------------
    const saveStates = new SaveStates(stores.saveStates as KeyValueStore<SaveStateRecord>);
    const sessionName = () => diskLabels[0] ?? modelName(model, roms.main);
    const currentSession = async (): Promise<Session> => {
      await persistAll();
      return {
        machine: apple.saveState(),
        model,
        modelName: modelName(model, roms.main),
        romsCrc: romsCrc(roms),
        mockingboard: apple.mockingboardOn,
        disks: apple.disk2.drives.map((drive, i) => {
          const disk = drive.disk;
          return disk ? { name: diskLabels[i] ?? disk.name, format: disk.format, woz: disk.toWoz(), origin: diskSaves.origin(i) } : null;
        }),
      };
    };
    const restoreSession = async (session: Session) => {
      // A state from another model switches to it, if its ROMs are here.
      const stored = await romStore.load();
      const sessionRoms = hasRequiredRoms(stored, session.model) ? machineRoms(stored, session.model) : null;
      if (!sessionRoms || session.romsCrc !== romsCrc(sessionRoms)) {
        throw new Error(`That state was saved on an ${session.modelName} with other ROMs; load those (Machine setup...) to use it.`);
      }
      await persistAll();
      if (session.model !== model || sessionRoms.main !== roms.main) switchMachine(session.model, sessionRoms);
      mockingboard.checked = session.mockingboard;
      apple.setMockingboard(session.mockingboard);
      session.disks.forEach((saved, drive) => {
        const disk = saved ? FloppyDisk.restore(saved.name, saved.format, saved.woz) : null;
        apple.insertDisk(drive, disk);
        diskSaves.adopt(drive, saved?.origin ?? null);
        diskLabels[drive] = saved?.name ?? null;
        if (disk && saved) diskPanel.showDisk(drive, saved.name, describeDisk(disk), false);
        else diskPanel.showEmpty(drive);
      });
      apple.loadState(session.machine);
      emulator.resetTiming();
      audio?.flush();
      updateStatus();
    };

    // --- Panels ----------------------------------------------------------------------
    let allGames: BundledGame[] = [];
    /** The free games this machine can run, as listed in the picker. */
    let bundledGames: BundledGame[] = [];
    const showGames = () => {
      bundledGames = allGames.filter((game) => runsOn(game, machine()));
      const href = (link?: string) => (link?.startsWith('games/') ? `${import.meta.env.BASE_URL}${link}` : link);
      diskPanel.setGames(bundledGames.map((game) => ({ ...game, licenseHref: href(game.licenseUrl), sourceHref: href(game.sourceUrl) })));
    };

    /** Becomes another model (or the same one with other ROMs), switched off and on. */
    const switchMachine = (newModel: Model, newRoms: typeof roms) => {
      model = newModel;
      roms = newRoms;
      machineRecord.write({ model });
      apple.setRoms(roms, model);
      capsLock.disabled = !apple.hasMmu;
      mockingboard.disabled = isIIcModel(model);
      updateStatus();
      showGames();
    };
    /** Puts one disk image in a drive, or loads a save state. */
    const openDisk = async (file: File, drive: number) => {
      const media = await readMedia(file);
      if (media.kind === 'state') {
        await restoreSession(await decodeSession(media.bytes));
        toolbar.showMessage('Save state loaded');
        return;
      }
      await persistDisk(drive);
      const { disk, hasSavedChanges } = await diskSaves.openImage(drive, media.name, media.data);
      const game = bundledGames.find((entry) => entry.file.split('/').pop() === file.name);
      showDisk(drive, disk, game?.title ?? titleFromFileName(file.name), hasSavedChanges);
      diskPanel.markSetDisk(drive, file.name);
    };

    /** Files dropped or chosen together: every disk in them gets a place in the Swap menus, and the first goes in. */
    const openFiles = async (chosen: File[], drive: number) => {
      const files = (await Promise.all(chosen.map((file) => filesFrom(file)))).flat();
      if (chosen.length > 1) files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const first = firstDisk(files);
      diskPanel.setZipFiles(files.length > 1 ? files : []);
      await openDisk(first, drive);
    };

    const diskPanel = new DiskPanel(requireElement('#disk-panel'), {
      onFiles: openFiles,
      onSwapDisk: openDisk,
      onEject: eject,
      onRevert: async (drive) => {
        const disk = await diskSaves.revert(drive);
        if (!disk) return;
        apple.insertDisk(drive, disk);
        diskPanel.setSavedChanges(drive, false);
      },
      onDownload: async (drive) => {
        const disk = apple.disk2.drives[drive].disk;
        if (!disk) return;
        if (!disk.savesCompletely) diskPanel.showMessage("Some tracks of this disk aren't in the standard format; the download only has the ones that are.", true);
        downloadFile(disk.toImage(), `${slug(diskLabels[drive] ?? disk.name)}${disk.extension}`);
      },
      onGame: (index) => fetchGame(import.meta.env.BASE_URL, bundledGames[index]),
      onPlayGame: async (file) => {
        await openFiles([file], 0);
        powerCycle();
        if (model === 'ii') {
          // The Apple II has no autostart: boot drive 1 from the Monitor, as its owner would.
          apple.typeKeys('C600G\n');
          diskPanel.showMessage('');
        }
      },
      onNewSaveDisk: async (drive) => {
        await persistDisk(drive);
        const { disk, name } = await diskSaves.createSaveDisk(drive);
        apple.insertDisk(drive, disk);
        diskLabels[drive] = name;
        diskPanel.showDisk(drive, name, 'blank disk: format it from the game, DOS (INIT) or ProDOS', false);
        await refreshSaveDisks();
      },
      onInsertSaveDisk: async (id, drive) => {
        await persistDisk(drive);
        const opened = await diskSaves.openSaveDisk(drive, id);
        if (!opened) throw new Error('That save disk no longer exists.');
        showDisk(drive, opened.disk, opened.name, false);
      },
      onExportSaveDisk: async (id) => {
        await persistAll();
        const bytes = await diskSaves.saveDiskBytes(id);
        const name = (await diskSaves.listSaveDisks()).find((disk) => disk.id === id)?.name ?? 'save disk';
        if (bytes) downloadFile(bytes, `${slug(name)}.dsk`);
      },
      onDeleteSaveDisk: async (id) => {
        for (let drive = 0; drive < DRIVES; drive++) {
          const origin = diskSaves.origin(drive);
          if (origin?.kind === 'saveDisk' && origin.id === id) {
            apple.insertDisk(drive, null);
            diskLabels[drive] = null;
            diskPanel.showEmpty(drive);
          }
        }
        await diskSaves.deleteSaveDisk(id);
        await refreshSaveDisks();
      },
      onWarp: (enabled) => (emulator.warpWhileLoading = enabled),
      focusScreen,
    });

    const refreshStates = async () => toolbar.setStates(await saveStates.list());
    const toolbar = attachToolbar(requireElement('#toolbar'), {
      onPause: (pause) => {
        paused = pause;
        screenFrame.classList.toggle('paused', pause);
        emulator.resetTiming();
        audio?.flush();
      },
      onReset: ctrlReset,
      onPowerCycle: powerCycle,
      onFullscreen: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void screenFrame.requestFullscreen().then(focusScreen);
      },
      onSaveState: async () => {
        await saveStates.add(sessionName(), await currentSession());
        await refreshStates();
        toolbar.showMessage('State saved');
      },
      onLoadState: async (id) => {
        const session = await saveStates.load(id);
        if (!session) throw new Error('That save state no longer exists.');
        await restoreSession(session);
        toolbar.showMessage('State loaded');
      },
      onDeleteState: async (id) => {
        await saveStates.delete(id);
        await refreshStates();
      },
      onExportState: async () => {
        downloadFile(await encodeSession(await currentSession()), `${slug(sessionName())}${STATE_EXTENSION}`);
      },
      onImportState: async (file) => {
        await restoreSession(await decodeSession(new Uint8Array(await file.arrayBuffer())));
        toolbar.showMessage('Save state loaded');
      },
      focusScreen,
    });
    await refreshStates();
    await refreshSaveDisks();

    void loadGameManifest(import.meta.env.BASE_URL).then((games) => {
      allGames = games;
      showGames();
    });

    /** Shows Machine setup over the paused Apple; the machine and ROMs chosen take effect with a restart. */
    requireElement<HTMLButtonElement>('[data-action="machine-setup"]').addEventListener('click', () => {
      if (changingRoms) return;
      changingRoms = true;
      audio?.flush();
      void romStore
        .load()
        .then((stored) => askForMachine(romSetup, romStore, stored, { model, whileRunning: true }))
        .then(async (setup) => {
          changingRoms = false;
          if (setup && hasRequiredRoms(setup.roms, setup.model)) {
            await persistAll();
            switchMachine(setup.model, machineRoms(setup.roms, setup.model));
            powerCycle();
          }
          focusScreen();
        });
    });

    // --- Display and sound -----------------------------------------------------------
    const monitor = requireElement<HTMLSelectElement>('select[name="monitor"]');
    const applyMonitor = () => (apple.video.monitor = monitor.value as Monitor);
    monitor.addEventListener('change', () => {
      applyMonitor();
      focusScreen();
    });
    applyMonitor();

    const mockingboard = requireElement<HTMLInputElement>('input[name="mockingboard"]');
    mockingboard.addEventListener('change', () => {
      apple.setMockingboard(mockingboard.checked);
      updateStatus();
      focusScreen();
    });
    apple.setMockingboard(mockingboard.checked);
    mockingboard.disabled = isIIcModel(model);

    const sound = requireElement<HTMLInputElement>('input[name="sound"]');
    const volume = requireElement<HTMLInputElement>('input[name="volume"]');
    const soundHint = requireElement<HTMLElement>('.sound-hint');
    const applySound = () => {
      audio?.setEnabled(sound.checked);
      audio?.setVolume(Number(volume.value));
    };
    sound.addEventListener('change', applySound);
    volume.addEventListener('input', applySound);
    applySound();
    if (!audio) {
      sound.disabled = volume.disabled = true;
      soundHint.textContent = 'Sound is not supported in this browser';
      soundHint.hidden = false;
    } else if (!audio.running) {
      soundHint.hidden = false;
      audio.resumeOnGesture(window, () => (soundHint.hidden = true));
    }

    // --- Inputs ----------------------------------------------------------------------
    const joystick = new Joystick();
    const keyboard = new AppleKeyboard(apple, joystick);
    keyboard.attach(window);
    keyboard.onReset = ctrlReset;
    const capsLock = requireElement<HTMLInputElement>('input[name="caps-lock"]');
    // The II and II Plus only have capitals.
    capsLock.disabled = !apple.hasMmu;
    keyboard.capsLock = capsLock.checked;
    capsLock.addEventListener('change', () => {
      keyboard.capsLock = capsLock.checked;
      focusScreen();
    });
    keyboard.onCapsLock = (on) => {
      capsLock.checked = on;
      capsLock.dispatchEvent(new Event('change'));
    };

    const joystickKeys = requireElement<HTMLSelectElement>('select[name="joystick-keys"]');
    const joystickPad = requireElement<HTMLSelectElement>('select[name="joystick-pad"]');
    const applyJoystickKeys = () => keyboard.setJoystickKeys(joystickKeys.value as KeySetName);
    joystickKeys.addEventListener('change', () => {
      applyJoystickKeys();
      focusScreen();
    });
    joystickPad.addEventListener('change', focusScreen);
    applyJoystickKeys();

    const gamepads = new GamepadManager();
    gamepads.attach(window);
    const gamepadStatus = requireElement<HTMLElement>('.gamepad-status');
    let lastPadNames = '';
    const pollInputs = () => {
      const pads = gamepads.connected();
      const pad = joystickPad.value === 'off' ? undefined : pads[Number(joystickPad.value)];
      if (pad) joystick.set('gamepad', readGamepad(pad));
      else joystick.clear('gamepad');
      joystick.apply(apple, keyboard.openApple, keyboard.closedApple);
      const names = pads.map((pad, i) => `Gamepad ${i + 1}: ${padName(pad)}`).join(' · ');
      if (names !== lastPadNames) {
        lastPadNames = names;
        gamepadStatus.textContent = names;
      }
    };

    // --- Main loop -------------------------------------------------------------------
    const leds = [false, false];
    let last = performance.now();
    let wasWarped = false;
    const frame = (now: number) => {
      const elapsed = now - last;
      last = now;
      pollInputs();
      if (!paused && !changingRoms) {
        emulator.run(elapsed);
        // Warped sound would play many times too fast, so it is dropped.
        const samples = emulator.takeAudioSamples();
        if (emulator.warped !== wasWarped) audio?.flush();
        wasWarped = emulator.warped;
        if (!emulator.warped) audio?.play(samples);
      }
      const disk2 = apple.disk2;
      for (let drive = 0; drive < DRIVES; drive++) {
        const on = disk2.selected === drive && disk2.spinning(apple.cycles);
        if (on !== leds[drive]) {
          leds[drive] = on;
          diskPanel.setLed(drive, on);
        }
      }
      screen.present();
      requestAnimationFrame(frame);
    };

    diskPanel.showEmpty(0);
    diskPanel.showEmpty(1);
    updateStatus();
    powerCycle();
    focusScreen();
    requestAnimationFrame(frame);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

void main();
