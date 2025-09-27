/******************************************************************************/


import path from 'path';
import fs from 'fs';

import { parse as parseToml } from 'smol-toml';
import JSON5 from 'json5';


/******************************************************************************/


/* Given a path to a wrangler configuration file, load it and return the parsed
 * object. The extension of the file is used to determine whether the file is
 * in the TOML format or the JSONC format that wrangler allows.
 *
 * No validation is done to ensure that the data in the file is actually a valid
 * wrangler configuration file.
 *
 * An error will be thrown if the file extension is not recognized, or if there
 * is a format error in the file that causes it to not parse. */
export function loadWranglerConfig(filename) {
  const extension = path.extname(filename);
  const content = fs.readFileSync(filename, 'utf8');

  if (extension === '.toml') {
    return parseToml(content);
  }

  if (extension === '.jsonc') {
    return JSON5.parse(content);
  }

  throw new Error(`'${extension}' is not a valid wrangler config extension`);
}


/******************************************************************************/
