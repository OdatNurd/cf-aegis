/******************************************************************************/


import { parseEnv } from 'node:util';

import path from 'node:path';
import fs from 'node:fs';


/******************************************************************************/


/* This function looks for and loads environment variables and secrets from
 * files on disk, mimicking what wrangler would do in a similar situation (but
 * with changes to the files looked for, see below). This requires a Wrangler
 * configuration object and the name of the environment to load; the name of the
 * environment can either be a string or undefined, where undefined means "the
 * top level variables in the configuration". For example, this corresponds to
 * doing:
 *     wrangler dev -e staging   # envName is "staging"
 *     wrangler dev              # envName is undefined; use top level vars
 *
 * All loaded files are searched for relative to the location of the loaded
 * Wrangler configuraton file, if any. For the purposes of this call, that is
 * always the current working directory, since this happens as a part of the
 * config load and files referenced in the Wrangler configuration are also
 * relative.
 *
 * The argument rootDir represents current working directory at the point where
 * the test suite launched (e.g. before it was changed to load a Wrangler
 * config, etc); this is generall the project root, and is used to generate
 * filename logs that are relative to that location.
 *
 * In order to maintain security and not inadvertently leak secrets, although
 * this follows a load order similar to Wrangler the filenames it uses are
 * different to ensure that the variables defined for testing are explicit:
 *   - where Wrangler uses files prefixed with `.dev`, such as `.dev.vars`, this
 *     looks instead for `.test`, such as `.test.vars`
 *   - where Wrangler uses files prefixed with `.env`, such as `.env`, tis
 *     looks instead for `.test.env`.
 *
 * When multiple files exist, each are loaded and combined together in a
 * specific order; files that appear lower down in the list have a higher
 * precedence and will override any files that come before them in the list.
 *
 * Variables are sourced from:
 *   0. The "vars" key in the configuration, if any (that is, what is present
 *      in the configuration presented will eventually be overlaid with what
 *      may be loaded or produced by this call).
 *   1. .test.vars.envName or .test.vars
 *     OR
 *   1. .test.env
 *   2. .test.env.envName
 *   3. .test.env.local
 *   4. .test.env.envName.local
 *
 * That is, either a .test.vars is loaded, or .test.env files are loaded, but
 * never both. Additionaly, if a .test.vars file exists for the given envName,
 * then only that file is loaded; otherwise fallback is to .test.vars.
 *
 * As with wrangler, the following environment variables are respected and alter
 * how the configuraton is loaded in cases where there is not a .test.vars.*
 * loaded (that is, if .test.vars.* is loaded, these variables have no effect):
 *  - CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV
 *    By default, if there is not a .test.vars file loaded, the system will fall
 *    back to loading the .test.env files; if this environment variable exists
 *    and is set to "false", then the load of files from .test.env files will
 *    be skipped.
 *
 *  - CLOUDFLARE_INCLUDE_PROCESS_ENV
 *    If no .test.vars.* file was loaded and this environment variable exists
 *    and is set to "true", then the entire process environment is used as
 *    variables.
 *
 * Lastly, if the provided configuration has a secrets key:
 *   "secrets": {
 *      "required": ["API_KEY", "DB_PASSWORD"],
 *    },
 *
 * Then only variables listed here are used, and all other variables loaded
 * from files will be discarded. In addition, any variables mentioned here that
 * are not present in any loaded file will generate a warning.
 *
 * The return value is an object that contains the loaded keys and the values
 * they have (remembering the precedence rules). */
export function loadTestEnvironment(config, envName, rootDir) {
  let loadedVars = {};
  let loadedFiles = [];
  let loadedFromVars = false;

  // An inner helper to look to see if a fle exists or not, and if so, parse it
  // and return the variables from within it.
  //
  // This will also record that it loaded the file.
  const checkAndLoad = (filename) => {
    // Create an absolute file path to the file we're looking for, and then a
    // version of it that is relative to the root we were given, for use in
    // reporting.
    const asbFilePath = path.resolve(process.cwd(), filename);
    const relFilePath = path.relative(rootDir, asbFilePath);

    // If the file we're supposed to load exists, then load its content in and
    // parse it. If not, this will leave the loaded vars at null.
    let vars = null;
    if (fs.existsSync(asbFilePath) === true) {
      const content = fs.readFileSync(asbFilePath, 'utf8');
      loadedFiles.push(filename);
      vars = parseEnv(content);
    }

    // We can report before we return
    if (vars !== null) {
      console.log(`[cf-aegis] loaded ${Object.keys(vars).length} variable(s) from ${relFilePath}`);
    }

    return vars;
  };

  // First we want to load the .test.vars file, if it exists; this one is the
  // one that is specific to the environment provided.
  const specificVarsFile = envName !== undefined ? `.test.vars.${envName}` : null;
  let varsContent = specificVarsFile !== null ? checkAndLoad(specificVarsFile) : null;

  // If we got a result, start with these variables, and flag that we loaded
  // something. If not, then fall back to the version that does not have the
  // environment name and load that one instead.
  if (varsContent !== null) {
    loadedVars = varsContent;
    loadedFromVars = true;
  } else {
    varsContent = checkAndLoad('.test.vars');
    if (varsContent !== null) {
      loadedVars = varsContent;
      loadedFromVars = true;
    }
  }

  // If we didn't load any variables and we were not told to try to load .env
  // files, then try to load those now. There are a series of this, which we
  // load in order, combining the results together.
  if (loadedFromVars === false && process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV !== 'false') {
    const dotEnvFiles = [
      '.test.env',
      envName !== undefined ? `.test.env.${envName}` : null,
      '.test.env.local',
      envName !== undefined ? `.test.env.${envName}.local` : null
    ].filter(file => file !== null);

    // For each file, try to load it, and then combine its reults with the
    // variables that have been loaded previously.
    for (const file of dotEnvFiles) {
      const parsed = checkAndLoad(file);
      if (parsed !== null) {
        loadedVars = { ...loadedVars, ...parsed };
      }
    }
  }

  // If we were told to. we will load the entire process environment in as
  // variable bindings. In such a case, we don't want to print those values
  // later because they will be verbose and possibly leak secrets; so, take a
  // copy of the variables as we have them now.
  const fileLoadedKeys = new Set(Object.keys(loadedVars));
  let processEnvIncluded = false;

  // If we didn't load any variables and we were asked to load the process
  // environment, then pull in the whole of process.env here.
  if (loadedFromVars === false && process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV === 'true') {
    console.log(`[cf-aegis] including process.env variables (CLOUDFLARE_INCLUDE_PROCESS_ENV is true)`);
    loadedVars = { ...loadedVars, ...process.env };
    processEnvIncluded = true;
  }

  // The configuration we got might have a secrets.required list; if it does,
  // then we want to filter down to only the variables specified there, and
  // generate a warning message if any are missing.
  const requiredSecrets = config?.secrets?.required;
  if (Array.isArray(requiredSecrets) === true && requiredSecrets.length > 0) {
    // Filter down to ONLY the required secrets as per Cloudflare specification.
    // Parts of the documentation seems to think something around here would
    // pull missing variables from process.env, but not all parts agree and so
    // here we don't, because that is the failure policy of least unexpected
    // exposure.
    const filteredVars = {};
    const missing = [];
    for (const key of requiredSecrets) {
      if ((key in loadedVars) === true) {
        filteredVars[key] = loadedVars[key];
      } else {
        missing.push(key);
      }
    }
    loadedVars = filteredVars;

    // Did we find any required variables missing?
    if (missing.length > 0) {
      console.warn(`[cf-aegis] WARNING: Missing required secrets: ${missing.join(', ')}`);
    }
  }

  // For debug purposes, we output what it is that we loaded.
  const keys = Object.keys(loadedVars);
  if (keys.length > 0) {
    console.log(`[cf-aegis] injected Test Variables/Secrets:`);
    for (const key of keys) {
      // We have a list of variables but we only display the ones that we loaded
      // from files (because the list might contain keys from process.env).
      if (fileLoadedKeys.has(key) === true) {
        console.log(`  - ${key} = ${loadedVars[key]}`);
      }
    }

    // If we brought in the process.env, then say that, in a way that does not
    // leak anything.
    if (processEnvIncluded === true) {
      console.log(`  - (...plus variables from process.env)`);
    }
  } else if (loadedFiles.length > 0 || (Array.isArray(requiredSecrets) === true && requiredSecrets.length > 0)) {
    console.log(`[cf-aegis] no test variables or secrets loaded.`);
  }

  return loadedVars;
}


/******************************************************************************/
