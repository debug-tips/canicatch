'use strict';

const assert = require('assert');
const http = require('http');
const { remote } = require('webdriverio');
const { hashElement } = require('folder-hash');
const { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } = require('fs');
const path = require('path');

const IS_CI = process.env.NODE_ENV === 'CI';
const URL_PREFIX = IS_CI ? 'https://debug.tips/canicatch/fixtures_generated/' : 'http://127.0.0.1:3000/';
const REPORT_SCRIPTS = `function() { var span = document.createElement('span'); span.id = '__CAPTURED'; document.body.appendChild(span); }`;
const INJECT_CAPTURE_SCRIPTS = [{
  type: 'onerror',
  script: `window.onerror = ${REPORT_SCRIPTS};`,
}, {
  type: 'error',
  script: `document.addEventListener('error', ${REPORT_SCRIPTS}, true);`,
}, {
  type: 'promise',
  script: `window.addEventListener('unhandledrejection', ${REPORT_SCRIPTS});`,
}];

// Start a local server if running on local machine
if (!IS_CI) {
  let app = null;
  before(() => {
    // Start http server
    app = http.createServer((req, res) => {
      if (!existsSync(path.join(__dirname, 'fixtures_generated', req.url))) {
        res.writeHead(404);
        res.end();
        return;
      }

      res.writeHead(200);
      res.end(readFileSync(path.join(__dirname, 'fixtures_generated', req.url)));
    });

    app.listen(3000);
  });

  after(() => {
    if (app) {
      app.close();
    }
  });
}

async function getRegenerateStatus() {
  let fixturesHash = null;
  let needRegenerate = false;
  // Check for fixture folder hash
  const fixturesHashPath = path.join(__dirname, '.fixtures_hash');
  const currentFixturesHashObject = await hashElement(path.join(__dirname, 'fixtures'), { files: { include: ['*.html']}});
  const currentFixturesHash = currentFixturesHashObject.hash;
  if (existsSync(fixturesHashPath)) {
    fixturesHash = readFileSync(fixturesHashPath, { encoding: 'utf8'});
  }

  if (fixturesHash !== currentFixturesHash) {
    needRegenerate = true;
    writeFileSync(fixturesHashPath, currentFixturesHash, { encoding: 'utf8'});
  }

  return needRegenerate;
}

(async function() {
  const needRegenerate = getRegenerateStatus();
  // Generate real fixtures
  const files = readdirSync(path.join(__dirname, 'fixtures'), { encoding: 'utf8' });

  if (needRegenerate) {
    if (!existsSync(path.join(__dirname, 'fixtures_generated'))) {
      mkdirSync(path.join(__dirname, 'fixtures_generated'));
    }

    for (const file of files) {
      const html = readFileSync(path.join(__dirname, 'fixtures', file), { encoding: 'utf8'});
      for (const script of INJECT_CAPTURE_SCRIPTS) {
        writeFileSync(
          path.join(__dirname, 'fixtures_generated', `${file.split('.')[0]}_${script.type}.html`),
          html.replace('<head>', `<head><script>${script.script}</script>`),
          { encoding: 'utf8' }
        );
      }
    }
  }


  // Generate dynamic test suites
  for (const file of files) {
    describe(file, () => {
      for (const script of INJECT_CAPTURE_SCRIPTS) {
        it(`can be captured by ${script.type}`, async function() {
          this.timeout(20000);

          await browser.url(`${URL_PREFIX}${file.split('.')[0]}_${script.type}.html`);
          const captured = await browser.executeAsync(function(done) {
            done(document.getElementById('__CAPTURED') != null);
          });

          assert(captured === true);
        });
      }
    });
  }
}());
