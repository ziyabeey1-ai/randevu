import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('staging workflow exposes a storage-only G16 acceptance switch', () => {
  const workflow = readFileSync(new URL('../.github/workflows/staging.yml', import.meta.url), 'utf8');
  const deploy = readFileSync(new URL('../scripts/staging-deploy.mjs', import.meta.url), 'utf8');

  assert.match(workflow, /run_g16_storage_acceptance:/);
  assert.match(workflow, /RUN_G16_STORAGE_ACCEPTANCE: \$\{\{ inputs\.run_g16_storage_acceptance \}\}/);
  assert.match(deploy, /RUN_G16_STORAGE_ACCEPTANCE === 'true'/);
  assert.match(deploy, /gates\.g16 \|\| runG16StorageAcceptance/);
});

function runStorageOnly() {
  const runner = new URL('../scripts/staging-g16-acceptance.mjs', import.meta.url).href;
  const providerSource = `
    export const normalizeWhatsappPhone = () => { throw new Error('PROVIDER_SHOULD_NOT_RUN'); };
    export const netgsmWhatsappConfigured = () => { throw new Error('PROVIDER_SHOULD_NOT_RUN'); };
    export const sendWhatsappVerificationCode = async () => { throw new Error('PROVIDER_SHOULD_NOT_RUN'); };
  `;
  const bootstrap = `
    import cp from 'node:child_process';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    cp.execFileSync = () => {
      console.log('G16_TEST_STORAGE_STARTED');
      const error = new Error('synthetic storage boundary');
      error.code = 'EACCES';
      throw error;
    };
    syncBuiltinESMExports();
    globalThis.fetch = async () => { throw new Error('UNEXPECTED_HTTP_BEFORE_STORAGE'); };
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier.endsWith('/worker/whatsapp-verify.ts')) return {
          url: new URL(specifier, context.parentURL).href, shortCircuit: true,
        };
        return next(specifier, context);
      },
      load(url, context, next) {
        if (url.endsWith('/worker/whatsapp-verify.ts')) return {
          format: 'module', source: ${JSON.stringify(providerSource)}, shortCircuit: true,
        };
        return next(url, context);
      },
    });
    await import(${JSON.stringify(runner)});
  `;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', bootstrap], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 128 * 1024,
    env: {
      PATH: process.env.PATH,
      RUN_G16_STORAGE_ACCEPTANCE: 'true',
      RUN_G16_ACCEPTANCE: 'false',
      STAGING_APP_ORIGIN: 'https://app.invalid',
      STAGING_DATABASE_URL: 'postgresql://database.invalid/test',
      SUPABASE_URL: 'https://storage.invalid',
      SUPABASE_ANON_KEY: 'synthetic',
      STAGING_OWNER_A_EMAIL: 'a@example.invalid',
      STAGING_OWNER_A_PASSWORD: 'synthetic',
      STAGING_OWNER_B_EMAIL: 'b@example.invalid',
      STAGING_OWNER_B_PASSWORD: 'synthetic',
    },
  });
}

test('storage-only G16 reaches the Storage path without NetGSM settings or provider calls', () => {
  const output = runStorageOnly();
  assert.ifError(output.error);
  assert.equal(output.status, 1);
  const combined = output.stdout + output.stderr;
  assert.match(output.stdout, /G16_TEST_STORAGE_STARTED/);
  assert.doesNotMatch(combined, /PROVIDER_SHOULD_NOT_RUN|NETGSM_USERCODE|NETGSM_PASSWORD|NETGSM_ACCEPTANCE_PHONE/);
  assert.match(combined, /G16 hosted Storage acceptance\/cleanup failed|G16 database command failed/);
  assert.doesNotMatch(output.stdout, /G16 hosted private Storage acceptance passed|G16 hosted acceptance passed/);
});

test('full G16 still fails closed when NetGSM settings are missing', () => {
  const runner = new URL('../scripts/staging-g16-acceptance.mjs', import.meta.url).href;
  const providerSource = `
    export const normalizeWhatsappPhone = () => { throw new Error('PROVIDER_SHOULD_NOT_RUN'); };
    export const netgsmWhatsappConfigured = () => { throw new Error('PROVIDER_SHOULD_NOT_RUN'); };
    export const sendWhatsappVerificationCode = async () => { throw new Error('PROVIDER_SHOULD_NOT_RUN'); };
  `;
  const bootstrap = `
    import { registerHooks } from 'node:module';
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier.endsWith('/worker/whatsapp-verify.ts')) return {
          url: new URL(specifier, context.parentURL).href, shortCircuit: true,
        };
        return next(specifier, context);
      },
      load(url, context, next) {
        if (url.endsWith('/worker/whatsapp-verify.ts')) return {
          format: 'module', source: ${JSON.stringify(providerSource)}, shortCircuit: true,
        };
        return next(url, context);
      },
    });
    await import(${JSON.stringify(runner)});
  `;
  const output = spawnSync(process.execPath, ['--input-type=module', '--eval', bootstrap], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 128 * 1024,
    env: {
      PATH: process.env.PATH,
      RUN_G16_ACCEPTANCE: 'true',
      STAGING_APP_ORIGIN: 'https://app.invalid',
      STAGING_DATABASE_URL: 'postgresql://database.invalid/test',
      SUPABASE_URL: 'https://storage.invalid',
      SUPABASE_ANON_KEY: 'synthetic',
      STAGING_OWNER_A_EMAIL: 'a@example.invalid',
      STAGING_OWNER_A_PASSWORD: 'synthetic',
      STAGING_OWNER_B_EMAIL: 'b@example.invalid',
      STAGING_OWNER_B_PASSWORD: 'synthetic',
    },
  });
  assert.ifError(output.error);
  assert.equal(output.status, 1);
  assert.match(output.stderr, /Missing required G16 staging environment variable: NETGSM_USERCODE/);
  assert.doesNotMatch(output.stdout + output.stderr, /PROVIDER_SHOULD_NOT_RUN/);
});
