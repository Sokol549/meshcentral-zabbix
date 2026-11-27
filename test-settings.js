'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const zabbixApi = require('./zabbix-api');

async function run() {
  // 1. parseTemplateList & collectTemplatesForInstall
  assert.deepStrictEqual(zabbixApi.parseTemplateList(''), []);
  assert.deepStrictEqual(
    zabbixApi.parseTemplateList('Template A\nTemplate B, Template A; Template C\r\n'),
    ['Template A', 'Template B', 'Template C']
  );

  // 2. validateApiUrl edge cases
  assert.strictEqual(zabbixApi.validateApiUrl(''), '');
  assert.strictEqual(
    zabbixApi.validateApiUrl('https://zabbix.it.kzvs.pro/api_jsonrpc.php'),
    'https://zabbix.it.kzvs.pro/api_jsonrpc.php'
  );
  assert.throws(() => zabbixApi.validateApiUrl('ftp://zabbix.local/api'), /http:\/\/ или https:\/\//);
  assert.throws(() => zabbixApi.validateApiUrl('not-a-url'), /Некорректный URL/);

  // 3. saveUserSettings / loadUserSettings / sanitizeForClient
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zabbix-plugin-test-'));
  try {
    const userId = 'user//admin';
    const saved = zabbixApi.saveUserSettings(tmpDir, userId, {
      apiUrl: 'http://127.0.0.1:18080/api_jsonrpc.php',
      apiToken: 'secret-token-123',
      autoApplyTemplates: true,
      templatesCommon: 'Windows by Zabbix agent active\nCustom Alert Template',
      templatesCash: 'KZVS pharmacy cash register availability',
      templatesOccasional: '',
      templatesRestic: 'Restic Windows scheduled tasks active'
    });
    assert.strictEqual(saved.apiToken, 'secret-token-123');

    const sanitized = zabbixApi.sanitizeForClient(saved);
    assert.strictEqual(sanitized.hasApiToken, true);
    assert.strictEqual('apiToken' in sanitized, false);

    // Updating without token keeps existing token
    const updated = zabbixApi.saveUserSettings(tmpDir, userId, {
      apiUrl: 'http://127.0.0.1:18080/api_jsonrpc.php',
      apiToken: '',
      templatesCommon: 'Windows by Zabbix agent active\nCustom Alert Template'
    });
    assert.strictEqual(updated.apiToken, 'secret-token-123');

    // Collect templates for cash + restic
    assert.deepStrictEqual(
      zabbixApi.collectTemplatesForInstall(updated, 'cash', true),
      [
        'Windows by Zabbix agent active',
        'Custom Alert Template',
        'KZVS pharmacy cash register availability',
        'Restic Windows scheduled tasks active'
      ]
    );

    // Clear token
    const cleared = zabbixApi.saveUserSettings(tmpDir, userId, { clearApiToken: true });
    assert.strictEqual(cleared.apiToken, '');
    assert.strictEqual(zabbixApi.sanitizeForClient(cleared).hasApiToken, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 4. Mock Zabbix API server for testConnection & applyTemplatesForHost
  let lastUpdatePayload = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const rpc = JSON.parse(body);
      res.setHeader('Content-Type', 'application/json-rpc');
      if (rpc.method === 'apiinfo.version') {
        res.end(JSON.stringify({ jsonrpc: '2.0', result: '7.0.10', id: rpc.id }));
      } else if (rpc.method === 'template.get') {
        assert.strictEqual(req.headers.authorization, 'Bearer test-token');
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          result: [
            { templateid: '101', host: 'Windows by Zabbix agent active', name: 'Windows by Zabbix agent active' },
            { templateid: '102', host: 'Custom Alert Template', name: 'Custom Alert Template' },
            { templateid: '103', host: 'Existing Base', name: 'Existing Base' }
          ],
          id: rpc.id
        }));
      } else if (rpc.method === 'host.get') {
        const requested = rpc.params && rpc.params.filter && rpc.params.filter.host && rpc.params.filter.host[0];
        if (requested === 'missing-host') {
          res.end(JSON.stringify({ jsonrpc: '2.0', result: [], id: rpc.id }));
        } else {
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            result: [{
              hostid: '5001',
              host: requested,
              parentTemplates: [{ templateid: '103', host: 'Existing Base', name: 'Existing Base' }]
            }],
            id: rpc.id
          }));
        }
      } else if (rpc.method === 'host.update') {
        lastUpdatePayload = rpc.params;
        res.end(JSON.stringify({ jsonrpc: '2.0', result: { hostids: ['5001'] }, id: rpc.id }));
      } else {
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { message: 'Unknown method' }, id: rpc.id }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const apiUrl = 'http://127.0.0.1:' + port + '/api_jsonrpc.php';

  try {
    const testRes = await zabbixApi.testConnection({
      apiUrl,
      apiToken: 'test-token',
      templatesCommon: 'Windows by Zabbix agent active\nNonExistent Template',
      templatesCash: '',
      templatesOccasional: '',
      templatesRestic: ''
    });
    assert.strictEqual(testRes.version, '7.0.10');
    assert.strictEqual(testRes.matched.length, 1);
    assert.deepStrictEqual(testRes.missing, ['NonExistent Template']);

    const applyRes = await zabbixApi.applyTemplatesForHost({
      settings: {
        apiUrl,
        apiToken: 'test-token',
        autoApplyTemplates: true,
        templatesCommon: 'Windows by Zabbix agent active\nCustom Alert Template\nMissing One',
        templatesCash: '',
        templatesOccasional: '',
        templatesRestic: ''
      },
      hostname: 'apteka1-PC01',
      mode: 'occasional',
      restic: false,
      maxAttempts: 1,
      retryDelayMs: 0
    });
    assert.strictEqual(applyRes.applied, true);
    assert.deepStrictEqual(applyRes.linked, ['Windows by Zabbix agent active', 'Custom Alert Template']);
    assert.deepStrictEqual(applyRes.missingTemplates, ['Missing One']);
    assert.deepStrictEqual(lastUpdatePayload, {
      hostid: '5001',
      templates: [{ templateid: '103' }, { templateid: '101' }, { templateid: '102' }]
    });

    await assert.rejects(
      () => zabbixApi.applyTemplatesForHost({
        settings: { apiUrl, apiToken: 'test-token', autoApplyTemplates: true, templatesCommon: 'Custom Alert Template' },
        hostname: 'missing-host',
        mode: 'occasional',
        restic: false,
        maxAttempts: 1,
        retryDelayMs: 0
      }),
      /ещё не появился в Zabbix/
    );
  } finally {
    server.close();
  }

  console.log('All zabbix-api tests passed!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
