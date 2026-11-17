import { toSlug } from '../features/slug/index.ts';

const [text] = process.argv.slice(2);
if (text === undefined) {
  console.error('使い方: node src/app/cli.ts "<文字列>"');
  process.exitCode = 2;
} else {
  console.log(toSlug(text));
}
