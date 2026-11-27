'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const TEMPLATE_FIELDS = ['templatesCommon', 'templatesCash', 'templatesOccasional', 'templatesRestic'];
const MAX_TEXT_LENGTH = 4096;
const MAX_URL_LENGTH = 512;

function parseTemplateList(raw) {
  if (typeof raw !== 'string') return [];
  const seen = new Set();
  const list = [];
  for (const part of raw.split(/[\r\n,;]+/)) {
    const name = part.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    list.push(name);
  }
  return list;
}

function validateApiUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (value.length > MAX_URL_LENGTH) throw Error('URL Zabbix API слишком длинный.');
  let parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    throw Error('Некорректный URL Zabbix API.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Error('URL Zabbix API должен начинаться с http:// или https://.');
  }
  return parsed.toString();
}

function settingsFilePath(datapath, userId) {
  const dir = path.join(datapath, 'zabbix-settings');
  const file = path.join(dir, crypto.createHash('sha256').update(String(userId)).digest('hex') + '.json');
  return { dir, file };
}

function defaultSettings() {
  return {
    apiUrl: '',
    apiToken: '',
    autoApplyTemplates: true,
    templatesCommon: '',
    templatesCash: '',
    templatesOccasional: '',
    templatesRestic: ''
  };
}

function loadUserSettings(datapath, userId) {
  const { file } = settingsFilePath(datapath, userId);
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const base = defaultSettings();
  if (typeof raw.apiUrl === 'string') base.apiUrl = raw.apiUrl;
  if (typeof raw.apiToken === 'string') base.apiToken = raw.apiToken;
  if (typeof raw.autoApplyTemplates === 'boolean') base.autoApplyTemplates = raw.autoApplyTemplates;
  for (const field of TEMPLATE_FIELDS) {
    if (typeof raw[field] === 'string') base[field] = raw[field];
  }
  return base;
}

function sanitizeForClient(settings) {
  return {
    apiUrl: settings.apiUrl || '',
    hasApiToken: Boolean(settings.apiToken),
    autoApplyTemplates: settings.autoApplyTemplates !== false,
    templatesCommon: settings.templatesCommon || '',
    templatesCash: settings.templatesCash || '',
    templatesOccasional: settings.templatesOccasional || '',
    templatesRestic: settings.templatesRestic || ''
  };
}

function mergeSettings(existing, input) {
  if (!input || typeof input !== 'object') throw Error('Некорректный формат настроек.');
  const next = Object.assign({}, existing);
  if (Object.prototype.hasOwnProperty.call(input, 'apiUrl')) {
    next.apiUrl = validateApiUrl(input.apiUrl);
  }
  if (input.clearApiToken === true) {
    next.apiToken = '';
  } else if (typeof input.apiToken === 'string' && input.apiToken.trim()) {
    const token = input.apiToken.trim();
    if (token.length > MAX_URL_LENGTH) throw Error('API-токен Zabbix слишком длинный.');
    next.apiToken = token;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'autoApplyTemplates')) {
    next.autoApplyTemplates = Boolean(input.autoApplyTemplates);
  }
  for (const field of TEMPLATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      if (typeof input[field] !== 'string' || input[field].length > MAX_TEXT_LENGTH) {
        throw Error('Некорректный список темплейтов в поле ' + field + '.');
      }
      next[field] = input[field].replace(/\r\n/g, '\n');
    }
  }
  return next;
}

function saveUserSettings(datapath, userId, input) {
  const existing = loadUserSettings(datapath, userId);
  const next = mergeSettings(existing, input);
  const { dir, file } = settingsFilePath(datapath, userId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (e) {}
  const temp = path.join(dir, crypto.randomBytes(16).toString('hex') + '.tmp');
  try {
    fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch (e) {}
  }
  return next;
}

function zabbixRpc(apiUrl, apiToken, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(apiUrl);
    } catch (e) {
      reject(Error('Некорректный URL Zabbix API.'));
      return;
    }
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params: params || {}, id: 1 });
    const headers = {
      'Content-Type': 'application/json-rpc',
      'Content-Length': Buffer.byteLength(payload, 'utf8')
    };
    if (apiToken) {
      headers['Authorization'] = 'Bearer ' + apiToken;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, { method: 'POST', headers, timeout: timeoutMs || 15000 }, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > 8 * 1024 * 1024) {
          req.destroy(Error('Ответ Zabbix API превышает допустимый размер.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(Error('Zabbix API вернул HTTP ' + res.statusCode + '.'));
          return;
        }
        let json;
        try {
          json = JSON.parse(body);
        } catch (e) {
          reject(Error('Zabbix API вернул некорректный JSON.'));
          return;
        }
        if (json.error) {
          const msg = json.error.data || json.error.message || 'Ошибка Zabbix API';
          reject(Error('Zabbix API (' + method + '): ' + msg));
          return;
        }
        resolve(json.result);
      });
    });
    req.on('timeout', () => req.destroy(Error('Превышено время ожидания ответа Zabbix API.')));
    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

function collectConfiguredTemplates(settings) {
  const all = new Set();
  for (const field of TEMPLATE_FIELDS) {
    for (const name of parseTemplateList(settings[field])) all.add(name);
  }
  return Array.from(all);
}

function collectTemplatesForInstall(settings, mode, restic) {
  const names = [];
  const seen = new Set();
  const addAll = (raw) => {
    for (const item of parseTemplateList(raw)) {
      if (!seen.has(item)) {
        seen.add(item);
        names.push(item);
      }
    }
  };
  addAll(settings.templatesCommon);
  if (mode === 'cash') addAll(settings.templatesCash);
  else if (mode === 'occasional') addAll(settings.templatesOccasional);
  if (restic) addAll(settings.templatesRestic);
  return names;
}

function indexTemplates(list) {
  const byKey = new Map();
  for (const tpl of list || []) {
    if (tpl.host) byKey.set(tpl.host, tpl);
    if (tpl.name) byKey.set(tpl.name, tpl);
  }
  return byKey;
}

async function testConnection(settings) {
  if (!settings.apiUrl) throw Error('Укажите URL Zabbix API.');
  if (!settings.apiToken) throw Error('Укажите API-токен Zabbix.');
  const version = await zabbixRpc(settings.apiUrl, '', 'apiinfo.version', {});
  const allTemplates = await zabbixRpc(settings.apiUrl, settings.apiToken, 'template.get', {
    output: ['templateid', 'host', 'name']
  });
  const byKey = indexTemplates(allTemplates);
  const configured = collectConfiguredTemplates(settings);
  const matched = [];
  const missing = [];
  for (const name of configured) {
    const found = byKey.get(name);
    if (found) matched.push({ input: name, templateid: found.templateid, host: found.host, name: found.name });
    else missing.push(name);
  }
  const available = (allTemplates || [])
    .map((t) => ({ templateid: t.templateid, host: t.host, name: t.name || t.host }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { version, matched, missing, available };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyTemplatesForHost(options) {
  const settings = options.settings;
  const hostname = String(options.hostname || '').trim();
  const mode = options.mode;
  const restic = Boolean(options.restic);
  if (!settings || settings.autoApplyTemplates === false) {
    return { applied: false, skipped: true, reason: 'Автоматическая привязка темплейтов отключена в настройках.' };
  }
  if (!settings.apiUrl || !settings.apiToken) {
    return { applied: false, skipped: true, reason: 'Zabbix API не настроен во вкладке «Настройки».' };
  }
  const desiredNames = collectTemplatesForInstall(settings, mode, restic);
  if (!desiredNames.length) {
    return { applied: false, skipped: true, reason: 'В настройках не указаны темплейты для выбранного профиля.' };
  }
  if (!hostname || hostname.length > 128) {
    throw Error('Не удалось определить корректное имя узла Zabbix (Hostname).');
  }

  const allTemplates = await zabbixRpc(settings.apiUrl, settings.apiToken, 'template.get', {
    output: ['templateid', 'host', 'name']
  });
  const byKey = indexTemplates(allTemplates);
  const targetTemplates = [];
  const missingTemplates = [];
  for (const name of desiredNames) {
    const found = byKey.get(name);
    if (found) targetTemplates.push(found);
    else missingTemplates.push(name);
  }
  if (!targetTemplates.length) {
    throw Error('Ни один из указанных темплейтов не найден в Zabbix: ' + missingTemplates.join(', '));
  }

  let host = null;
  const maxAttempts = options.maxAttempts || 6;
  const retryDelayMs = options.retryDelayMs !== undefined ? options.retryDelayMs : 5000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const hosts = await zabbixRpc(settings.apiUrl, settings.apiToken, 'host.get', {
      output: ['hostid', 'host'],
      filter: { host: [hostname] },
      selectParentTemplates: ['templateid', 'host', 'name']
    });
    if (Array.isArray(hosts) && hosts.length > 0) {
      host = hosts[0];
      break;
    }
    if (attempt < maxAttempts && retryDelayMs > 0) await sleep(retryDelayMs);
  }
  if (!host) {
    throw Error('Узел "' + hostname + '" ещё не появился в Zabbix (проверьте авторегистрацию и порт 10051).');
  }

  const existing = Array.isArray(host.parentTemplates) ? host.parentTemplates : [];
  const existingIds = new Set(existing.map((t) => String(t.templateid)));
  const mergedIds = existing.map((t) => ({ templateid: String(t.templateid) }));
  const newlyLinked = [];
  const alreadyLinked = [];
  for (const tpl of targetTemplates) {
    const id = String(tpl.templateid);
    if (existingIds.has(id)) {
      alreadyLinked.push(tpl.name || tpl.host);
    } else {
      existingIds.add(id);
      mergedIds.push({ templateid: id });
      newlyLinked.push(tpl.name || tpl.host);
    }
  }

  if (newlyLinked.length > 0) {
    await zabbixRpc(settings.apiUrl, settings.apiToken, 'host.update', {
      hostid: String(host.hostid),
      templates: mergedIds
    });
  }

  return {
    applied: true,
    hostname: host.host,
    linked: newlyLinked,
    alreadyLinked,
    missingTemplates
  };
}

module.exports = {
  TEMPLATE_FIELDS,
  parseTemplateList,
  validateApiUrl,
  defaultSettings,
  loadUserSettings,
  saveUserSettings,
  mergeSettings,
  sanitizeForClient,
  collectTemplatesForInstall,
  zabbixRpc,
  testConnection,
  applyTemplatesForHost
};
