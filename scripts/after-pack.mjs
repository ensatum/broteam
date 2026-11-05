import { copyFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertBinary,
  installNative,
  listNodeFiles,
  nativeModulePath,
} from './ensure-native.mjs';

export async function afterPack(context) {
  const platform = context.electronPlatformName;
  const nodes = listNodeFiles(context.appOutDir);
  const sqlite = nodes.filter((file) => file.endsWith(`${path.sep}better_sqlite3.node`));
  if (sqlite.length === 0) {
    throw new Error(`В ${context.appOutDir} нет better_sqlite3.node`);
  }

  let error;
  try {
    installNative(platform, context.arch);
    for (const dest of sqlite) copyFileSync(nativeModulePath, dest);
    for (const file of listNodeFiles(context.appOutDir)) {
      assertBinary(file, platform, context.arch);
    }
  } catch (err) {
    error = err;
  }

  try {
    installNative(process.platform, process.arch);
  } catch (err) {
    error = error || err;
  }
  if (error) throw error;
}

export default afterPack;
