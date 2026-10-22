// Downloads CPU tests (not committed):
// - Klaus Dormann's 6502 functional test and 65C02 extended opcodes test binaries (GPL).
// - The start of each opcode file of Tom Harte's 65x02 SingleStepTests (MIT) for the NMOS 6502
//   and the Rockwell 65C02. The full files are about 1 GB per CPU, so only the first
//   `node scripts/fetch-cpu-tests.mjs <count>` tests of each (100 by default) are kept.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const perOpcode = Number(process.argv[2] ?? 100);

const DORMANN = 'https://raw.githubusercontent.com/Klaus2m5/6502_65C02_functional_tests/master/bin_files';
const HARTE = 'https://raw.githubusercontent.com/SingleStepTests/65x02/main';
const VARIANTS = ['6502', 'rockwell65c02'];
/** Each test is about 400 bytes of JSON. */
const BYTES_PER_TEST = 600;

async function download(url, range) {
  const response = await fetch(url, range ? { headers: { Range: `bytes=0-${range - 1}` } } : undefined);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The complete tests at the start of a JSON array cut off mid-way. */
function completeTests(text, count) {
  const tests = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed.startsWith('{')) continue;
    try {
      tests.push(JSON.parse(trimmed));
    } catch {
      break;
    }
    if (tests.length === count) break;
  }
  return tests;
}

await mkdir(join(fixtures, 'dormann'), { recursive: true });
for (const name of ['6502_functional_test.bin', '65C02_extended_opcodes_test.bin']) {
  await writeFile(join(fixtures, 'dormann', name), await download(`${DORMANN}/${name}`));
  console.log(`Saved tests/fixtures/dormann/${name}`);
}

for (const variant of VARIANTS) {
  const dir = join(fixtures, '65x02', variant);
  await mkdir(dir, { recursive: true });
  const opcodes = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
  let saved = 0;
  // A few at a time, to be kind to the server.
  for (let i = 0; i < opcodes.length; i += 16) {
    await Promise.all(
      opcodes.slice(i, i + 16).map(async (opcode) => {
        const bytes = await download(`${HARTE}/${variant}/v1/${opcode}.json`, perOpcode * BYTES_PER_TEST);
        const tests = completeTests(bytes.toString('utf8'), perOpcode);
        await writeFile(join(dir, `${opcode}.json`), JSON.stringify(tests));
        saved += tests.length;
      }),
    );
  }
  console.log(`Saved ${saved} ${variant} tests in tests/fixtures/65x02/${variant}/`);
}
