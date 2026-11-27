'use strict';
const { build } = require('./builder');
const zabbixApi = require('./zabbix-api');

module.exports = function (parent) {
  const obj = {};
  const jobs = new WeakMap();
  obj.exports = ['onWebUIStartupEnd', 'onDeviceRefreshEnd', 'onPackageChunk', 'onSettings'];

  obj.serveraction = function (cmd, client) {
    const isSettingsAction = ['loadSettings', 'saveSettings', 'testZabbixApi', 'applyTemplates'].includes(cmd && cmd.pluginaction);
    const replyMethod = isSettingsAction ? 'onSettings' : 'onPackageChunk';
    if (!client || !client.user || ![0xffffffff, -1].includes(client.user.siteadmin)) {
      if (client && client.send) {
        client.send({ action: 'plugin', plugin: 'zabbix', method: replyMethod, error: 'Требуются полные права администратора MeshCentral.' });
      }
      return;
    }

    const reply = (m) => client.send(Object.assign({ action: 'plugin', plugin: 'zabbix', method: 'onPackageChunk' }, m));
    const settingsReply = (m) => client.send(Object.assign({ action: 'plugin', plugin: 'zabbix', method: 'onSettings' }, m));
    const server = parent.parent || parent.meshServer;

    try {
      if (cmd.pluginaction === 'build') {
        const data = build(cmd.config);
        jobs.set(client, { data: data, offset: 0, expires: Date.now() + 300000 });
        reply({ ready: true });
      } else if (cmd.pluginaction === 'next') {
        const j = jobs.get(client);
        if (!j || Date.now() > j.expires) {
          jobs.delete(client);
          throw Error('Время получения пакета истекло.');
        }
        const part = j.data.subarray(j.offset, j.offset + 196608);
        j.offset += part.length;
        const done = j.offset === j.data.length;
        reply({ data: part.toString('base64'), offset: j.offset, total: j.data.length, done: done });
        if (done) jobs.delete(client);
      } else if (cmd.pluginaction === 'cancel') {
        jobs.delete(client);
      } else if (cmd.pluginaction === 'loadSettings') {
        if (!server || !server.datapath || !client.user._id) throw Error('Хранилище настроек недоступно.');
        const settings = zabbixApi.loadUserSettings(server.datapath, client.user._id);
        settingsReply({ settings: zabbixApi.sanitizeForClient(settings) });
      } else if (cmd.pluginaction === 'saveSettings') {
        if (!server || !server.datapath || !client.user._id) throw Error('Хранилище настроек недоступно.');
        const saved = zabbixApi.saveUserSettings(server.datapath, client.user._id, cmd.settings);
        settingsReply({ saved: true, settings: zabbixApi.sanitizeForClient(saved) });
      } else if (cmd.pluginaction === 'testZabbixApi') {
        if (!server || !server.datapath || !client.user._id) throw Error('Хранилище настроек недоступно.');
        const existing = zabbixApi.loadUserSettings(server.datapath, client.user._id);
        const merged = cmd.settings ? zabbixApi.mergeSettings(existing, cmd.settings) : existing;
        zabbixApi.testConnection(merged)
          .then((testResult) => settingsReply({ testResult: testResult, requestId: cmd.requestId }))
          .catch((e) => settingsReply({ error: e.message, testError: true, requestId: cmd.requestId }));
      } else if (cmd.pluginaction === 'applyTemplates') {
        if (!server || !server.datapath || !client.user._id) throw Error('Хранилище настроек недоступно.');
        const settings = zabbixApi.loadUserSettings(server.datapath, client.user._id);
        zabbixApi.applyTemplatesForHost({
          settings: settings,
          hostname: cmd.hostname,
          mode: cmd.mode,
          restic: cmd.restic
        })
          .then((applyResult) => settingsReply({ applyResult: applyResult, requestId: cmd.requestId }))
          .catch((e) => settingsReply({ error: e.message, applyError: true, requestId: cmd.requestId }));
      }
    } catch (e) {
      if (isSettingsAction) {
        settingsReply({ error: e.message, requestId: cmd.requestId });
      } else {
        jobs.delete(client);
        reply({ error: e.message });
      }
    }
  };

  obj.onWebUIStartupEnd = function () {
    if (window.ZabbixPlugin) return;
    var style = document.createElement('style');
    style.id = 'zabbix-ui-style';
    style.textContent = `
      .zabbix-primary,#zabbix-dialog .zabbix-primary{background:#1769f5;color:#fff;border:1px solid #1769f5;border-radius:3px;padding:7px 12px;cursor:pointer;font:inherit}
      .zabbix-primary:hover,#zabbix-dialog .zabbix-primary:hover{background:#0758d8}
      #zabbix-dialog{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(14,25,43,.58);box-sizing:border-box}
      #zabbix-dialog form{box-sizing:border-box;width:min(680px,100%);max-height:calc(100vh - 36px);overflow:auto;background:#fff;color:#202a35;border-radius:7px;box-shadow:0 16px 48px #0005;font:14px Arial,sans-serif}
      #zabbix-dialog form *{box-sizing:border-box}
      #zabbix-dialog .zabbix-header{padding:16px 22px 12px;border-bottom:1px solid #dfe5ed}
      #zabbix-dialog h2{margin:0;font-size:20px}
      #zabbix-device{margin:5px 0 0;color:#5c6a7a;font-size:13px}
      #zabbix-dialog .zabbix-tabs{display:flex;gap:4px;padding:8px 22px 0;background:#f8fafc;border-bottom:1px solid #dfe5ed}
      #zabbix-dialog .zabbix-tab{background:transparent;color:#475569;border:1px solid transparent;border-bottom:none;border-radius:5px 5px 0 0;padding:7px 14px;cursor:pointer;font:13px Arial,sans-serif;font-weight:600;margin-bottom:-1px}
      #zabbix-dialog .zabbix-tab:hover{background:#edf4ff;color:#1e3a5f}
      #zabbix-dialog .zabbix-tab.active{background:#fff;color:#1769f5;border-color:#dfe5ed;border-bottom:1px solid #fff}
      #zabbix-dialog .zabbix-content{padding:14px 22px 10px}
      #zabbix-dialog .zabbix-card{padding:12px 14px;border:1px solid #dfe5ed;border-radius:5px;background:#f8fafc;margin-bottom:10px}
      #zabbix-dialog .zabbix-card:last-child{margin-bottom:0}
      #zabbix-dialog .zabbix-card h3{margin:0 0 10px;font-size:14px;color:#23354a}
      #zabbix-dialog .zabbix-card p{margin:0 0 10px}
      #zabbix-dialog .zabbix-card p:last-child{margin-bottom:0}
      #zabbix-dialog .zabbix-card label{display:block;color:#334155;font-size:12px;font-weight:600}
      #zabbix-dialog .zabbix-site-row,#zabbix-dialog .zabbix-picker-row{display:flex;align-items:end;gap:6px}
      #zabbix-dialog .zabbix-site-row label,#zabbix-dialog .zabbix-picker-row select{flex:1;min-width:0}
      #zabbix-dialog .zabbix-site-row button,#zabbix-dialog .zabbix-picker-row button{height:30px;white-space:nowrap}
      #zabbix-dialog .zabbix-picker-row{margin-top:8px}
      #zabbix-dialog input:not([type=checkbox]),#zabbix-dialog select,#zabbix-dialog textarea.zabbix-tpl-input{display:block;width:100%;margin:3px 0 0;padding:5px 8px;border:1px solid #b9c4d2;border-radius:3px;background:#fff;color:#202a35;font:13px Arial,sans-serif}
      #zabbix-dialog input:not([type=checkbox]),#zabbix-dialog select{height:30px}
      #zabbix-dialog textarea.zabbix-tpl-input{min-height:58px;resize:vertical;font-family:monospace;font-size:12px;line-height:1.35}
      #zabbix-dialog input:focus,#zabbix-dialog textarea:focus,#zabbix-dialog select:focus{outline:2px solid #90bcff;outline-offset:0;border-color:#1769f5}
      #zabbix-dialog .zabbix-card label:has(input[type=checkbox]){display:flex;align-items:center;gap:6px;margin-top:9px;font-weight:400}
      #zabbix-dialog .zabbix-note{margin:6px 0 0;color:#64748b;font-size:12px;line-height:1.35}
      #zabbix-dialog .zabbix-token-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}
      #zabbix-dialog .zabbix-token-state{font-size:12px;color:#475569}
      #zabbix-dialog .zabbix-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      #zabbix-dialog button:not(.zabbix-primary):not(.zabbix-tab){background:#fff;color:#285580;border:1px solid #b9c9dc;border-radius:3px;padding:6px 9px;cursor:pointer;font:13px Arial,sans-serif}
      #zabbix-dialog button:not(.zabbix-primary):not(.zabbix-tab):hover{background:#edf4ff}
      #zabbix-dialog .zabbix-footer{padding:10px 22px 14px;border-top:1px solid #e5eaf0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      #zabbix-status,#zabbix-settings-status{flex:1;min-width:180px;margin:0;color:#40536b;font-size:12px}
      #zabbix-dialog .zabbix-log-panel{padding:0 22px 10px}
      #zabbix-journal{width:100%;height:110px;resize:vertical;padding:8px;border:1px solid #b9c4d2;border-radius:3px;font:12px monospace;white-space:pre-wrap}
      #zabbix-dialog .zabbix-bulk-list{max-height:220px;overflow:auto;margin:10px 0;border:1px solid #dfe5ed;background:#fff}
      #zabbix-dialog .zabbix-bulk-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px 8px;border-bottom:1px solid #e5eaf0;align-items:center}
      #zabbix-dialog .zabbix-bulk-row span{overflow-wrap:anywhere}
      #zabbix-dialog .zabbix-bulk-result{grid-column:1/-1;color:#526274;font-size:12px}
      #zabbix-dialog .zabbix-bulk-row input{margin:0}
      @media(max-width:640px){#zabbix-dialog{padding:8px}#zabbix-dialog form{max-height:calc(100vh - 16px)}#zabbix-dialog .zabbix-header,#zabbix-dialog .zabbix-tabs,#zabbix-dialog .zabbix-content,#zabbix-dialog .zabbix-footer{padding-left:14px;padding-right:14px}#zabbix-dialog .zabbix-log-panel{padding-left:14px;padding-right:14px}#zabbix-dialog .zabbix-settings-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);

    window.ZabbixPlugin = {
      settingsCache: null,
      pendingApply: {},
      pendingTestId: null,
      activeTab: 'install',

      send: function (a, x) {
        meshserver.send(Object.assign({ action: 'plugin', plugin: 'zabbix', pluginaction: a }, x || {}));
      },

      inject: function () {
        var t = document.getElementById('p10info');
        if (t && !document.getElementById('zabbix-open')) {
          var b = document.createElement('button');
          b.id = 'zabbix-open';
          b.textContent = 'Zabbix';
          b.className = 'zabbix-primary';
          b.style.margin = '8px 8px 12px';
          b.onclick = this.open.bind(this);
          t.insertBefore(b, t.firstChild);
        }
        var bar = document.getElementById('devListToolbar') || document.getElementById('devicesButtonBar');
        if (bar && !document.getElementById('zabbix-bulk-open')) {
          var bulk = document.createElement('input');
          bulk.type = 'button';
          bulk.id = 'zabbix-bulk-open';
          bulk.value = 'Zabbix';
          bulk.onclick = this.openBulk.bind(this);
          var group = document.getElementById('GroupActionButton');
          if (group && group.parentNode === bar) bar.insertBefore(bulk, group.nextSibling);
          else bar.appendChild(bulk);
        }
      },

      log: function (s) {
        var e = document.getElementById('zabbix-journal');
        if (e) {
          e.value += '[' + new Date().toLocaleTimeString() + '] ' + s + '\n';
          e.scrollTop = e.scrollHeight;
        }
      },

      status: function (s) {
        var e = document.getElementById('zabbix-status');
        if (e) e.textContent = s;
        this.log(s);
      },

      settingsStatus: function (s) {
        var e = document.getElementById('zabbix-settings-status');
        if (e) e.textContent = s;
      },

      transliterate: function (name) {
        var map = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya' };
        var out = '';
        for (var ch of String(name || '').toLowerCase()) {
          if (Object.prototype.hasOwnProperty.call(map, ch)) out += map[ch];
          else if (/[a-z0-9_-]/.test(ch)) out += ch;
          else out += '-';
        }
        return out.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 64).replace(/[-_]+$/g, '');
      },

      parseTemplateCount: function (raw) {
        if (typeof raw !== 'string') return 0;
        return raw.split(/[\r\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean).length;
      },

      shouldApplyTemplates: function (cfg) {
        var s = this.settingsCache;
        if (!s || s.autoApplyTemplates === false || !s.apiUrl || !s.hasApiToken) return false;
        var count = this.parseTemplateCount(s.templatesCommon)
          + (cfg && cfg.mode === 'cash' ? this.parseTemplateCount(s.templatesCash) : this.parseTemplateCount(s.templatesOccasional))
          + (cfg && cfg.restic ? this.parseTemplateCount(s.templatesRestic) : 0);
        return count > 0;
      },

      switchTab: function (tab) {
        var dialog = document.getElementById('zabbix-dialog');
        if (!dialog) return;
        this.activeTab = tab === 'settings' ? 'settings' : 'install';
        Array.from(dialog.querySelectorAll('.zabbix-tab')).forEach(function (btn) {
          btn.classList.toggle('active', btn.dataset.tab === window.ZabbixPlugin.activeTab);
        });
        var installView = dialog.querySelector('[data-view="install"]');
        var settingsView = dialog.querySelector('[data-view="settings"]');
        if (installView) installView.hidden = this.activeTab !== 'install';
        if (settingsView) settingsView.hidden = this.activeTab !== 'settings';
      },

      populateSettingsForm: function (s) {
        var form = document.querySelector('#zabbix-dialog form');
        if (!form || !s) return;
        if (!form._dirtySettings || !form._dirtySettings.apiUrl) form.elements.apiUrl.value = s.apiUrl || '';
        if (!form._dirtySettings || !form._dirtySettings.apiToken) form.elements.apiToken.value = '';
        if (!form._dirtySettings || !form._dirtySettings.autoApplyTemplates) form.elements.autoApplyTemplates.checked = s.autoApplyTemplates !== false;
        if (!form._dirtySettings || !form._dirtySettings.templatesCommon) form.elements.templatesCommon.value = s.templatesCommon || '';
        if (!form._dirtySettings || !form._dirtySettings.templatesCash) form.elements.templatesCash.value = s.templatesCash || '';
        if (!form._dirtySettings || !form._dirtySettings.templatesOccasional) form.elements.templatesOccasional.value = s.templatesOccasional || '';
        if (!form._dirtySettings || !form._dirtySettings.templatesRestic) form.elements.templatesRestic.value = s.templatesRestic || '';
        form.elements.apiToken.placeholder = s.hasApiToken
          ? 'Токен сохранён на сервере (введите новый только для замены)'
          : 'Вставьте API-токен Zabbix';
        var tokenState = document.getElementById('zabbix-token-state');
        var clearBtn = document.getElementById('zabbix-clear-token');
        if (tokenState) {
          tokenState.textContent = s.hasApiToken ? 'API-токен сохранён на сервере.' : 'API-токен не задан.';
          tokenState.style.color = s.hasApiToken ? '#15803d' : '#475569';
        }
        if (clearBtn) clearBtn.hidden = !s.hasApiToken;
      },

      queueSettingsSave: function (form) {
        var self = this;
        clearTimeout(form._saveTimer);
        form._saveTimer = setTimeout(function () {
          self.flushSettingsSave(form, true);
        }, 600);
      },

      flushSettingsSave: function (form, automatic) {
        if (!form || !form._saveTimer) return;
        clearTimeout(form._saveTimer);
        form._saveTimer = null;
        try {
          this.send('saveSettings', { settings: this.readSettingsForm(form, false), automatic: Boolean(automatic) });
          form._dirtySettings = {};
        } catch (e) {
          this.settingsStatus('Ошибка: ' + e.message);
        }
      },

      readSettingsForm: function (form, clearToken) {
        return {
          apiUrl: form.elements.apiUrl.value.trim(),
          apiToken: form.elements.apiToken.value.trim(),
          clearApiToken: Boolean(clearToken),
          autoApplyTemplates: form.elements.autoApplyTemplates.checked,
          templatesCommon: form.elements.templatesCommon.value,
          templatesCash: form.elements.templatesCash.value,
          templatesOccasional: form.elements.templatesOccasional.value,
          templatesRestic: form.elements.templatesRestic.value
        };
      },

      onSettingsMessage: function (m) {
        if (!m) return;
        if (m.requestId && this.pendingApply[m.requestId]) {
          var cb = this.pendingApply[m.requestId];
          delete this.pendingApply[m.requestId];
          cb(m);
          return;
        }
        if (m.settings) {
          this.settingsCache = m.settings;
          this.populateSettingsForm(m.settings);
          if (m.saved) this.settingsStatus('Настройки сохранены.');
          else this.settingsStatus('Настройки загружены.');
          return;
        }
        if (m.testResult && (!m.requestId || m.requestId === this.pendingTestId)) {
          this.pendingTestId = null;
          var r = m.testResult;
          var picker = document.getElementById('zabbix-tpl-picker');
          var select = document.getElementById('zabbix-tpl-select');
          if (picker && select && Array.isArray(r.available)) {
            select.innerHTML = '';
            r.available.forEach(function (tpl) {
              var opt = document.createElement('option');
              opt.value = tpl.host;
              opt.textContent = tpl.name && tpl.name !== tpl.host ? (tpl.name + ' (' + tpl.host + ')') : tpl.host;
              select.appendChild(opt);
            });
            picker.hidden = r.available.length === 0;
          }
          var msg = 'Zabbix API ' + r.version + ': найдено ' + r.matched.length + ' из ' + (r.matched.length + r.missing.length) + ' темплейтов.';
          if (r.missing.length) msg += ' Не найдены: ' + r.missing.join(', ') + '.';
          this.settingsStatus(msg);
          return;
        }
        if (m.error) {
          this.settingsStatus('Ошибка: ' + m.error);
        }
      },

      open: function (chosen) {
        var n = chosen && chosen._id ? chosen : window.currentNode;
        if (!n || !n._id) { alert('Откройте карточку компьютера.'); return; }
        if (document.getElementById('zabbix-dialog')) return;

        var d = document.createElement('div');
        d.id = 'zabbix-dialog';
        d.setAttribute('role', 'dialog');
        d.setAttribute('aria-modal', 'true');
        d.setAttribute('aria-labelledby', 'zabbix-title');
        ['keydown', 'keypress', 'keyup'].forEach(function (type) {
          d.addEventListener(type, function (event) { event.stopPropagation(); });
        });

        d.innerHTML = `<form>
          <div class="zabbix-header">
            <h2 id="zabbix-title">Установить Zabbix</h2>
            <p id="zabbix-device"></p>
          </div>
          <div class="zabbix-tabs" role="tablist">
            <button type="button" class="zabbix-tab active" data-tab="install" role="tab">Установка</button>
            <button type="button" class="zabbix-tab" data-tab="settings" role="tab">Настройки</button>
          </div>
          <div data-view="install">
            <div class="zabbix-content">
              <section class="zabbix-card">
                <p><label>Сервер Zabbix<input name="server" value="160.5.219.29" required></label></p>
                <div class="zabbix-site-row">
                  <label>Название точки (латиница, цифры, _ или -)<input name="site" required pattern="[A-Za-z0-9_-]{1,64}"></label>
                  <button type="button" id="zabbix-site-name" title="Взять имя компьютера из карточки">Имя ПК</button>
                </div>
                <p style="margin-top:10px">
                  <label>Общий ключ авторегистрации PSK (64 символа hex)<input name="psk" type="password" required pattern="[0-9a-fA-F]{64}" autocomplete="off"></label>
                  <label><input type="checkbox" name="remember"> Сохранить ключ в этом браузере</label>
                </p>
                <p>
                  <label>Тип компьютера
                    <select name="mode">
                      <option value="cash">Касса / постоянный ПК (09:00-20:00)</option>
                      <option value="occasional">Включается по необходимости</option>
                    </select>
                  </label>
                  <label><input type="checkbox" name="restic"> Контроль резервных копий Restic</label>
                </p>
              </section>
            </div>
            <div class="zabbix-log-panel" hidden>
              <textarea id="zabbix-journal" readonly aria-label="Журнал установки"></textarea>
              <button type="button" id="zabbix-load-log" style="margin-top:6px">Загрузить журнал установки</button>
            </div>
            <div class="zabbix-footer">
              <p id="zabbix-status" role="status">Установка для 64-битной Windows.</p>
              <button type="button" id="zabbix-toggle-log">Журнал</button>
              <button type="button" id="zabbix-close">Закрыть</button>
              <button type="submit" class="zabbix-primary">Установить</button>
            </div>
          </div>
          <div data-view="settings" hidden>
            <div class="zabbix-content">
              <section class="zabbix-card">
                <h3>Подключение к Zabbix API</h3>
                <p><label>URL Zabbix API<input name="apiUrl" type="url" placeholder="https://zabbix.it.kzvs.pro/api_jsonrpc.php"></label></p>
                <p>
                  <label>API-токен Zabbix<input name="apiToken" type="password" autocomplete="new-password" placeholder="Вставьте токен или оставьте пустым, чтобы не менять"></label>
                  <div class="zabbix-token-row">
                    <span id="zabbix-token-state" class="zabbix-token-state">Загрузка настроек…</span>
                    <button type="button" id="zabbix-clear-token" hidden>Очистить токен</button>
                  </div>
                </p>
                <label><input type="checkbox" name="autoApplyTemplates" checked> Автоматически привязывать указанные темплейты после установки</label>
                <p class="zabbix-note">Настройки и токен сохраняются на сервере MeshCentral для вашей учётной записи администратора.</p>
              </section>
              <section class="zabbix-card">
                <h3>Темплейты (шаблоны) для алертов при подключении новых ПК</h3>
                <p class="zabbix-note" style="margin:0 0 8px">Укажите названия темплейтов Zabbix (по одному в строке или через запятую). Существующие темплейты хоста сохраняются.</p>
                <div class="zabbix-settings-grid">
                  <label>Общие для всех новых ПК<textarea class="zabbix-tpl-input" name="templatesCommon" placeholder="По одному темплейту в строке"></textarea></label>
                  <label>Профиль «Касса / постоянный ПК»<textarea class="zabbix-tpl-input" name="templatesCash" placeholder="По одному темплейту в строке"></textarea></label>
                  <label>Профиль «По необходимости»<textarea class="zabbix-tpl-input" name="templatesOccasional" placeholder="По одному темплейту в строке"></textarea></label>
                  <label>При включённом контроле Restic<textarea class="zabbix-tpl-input" name="templatesRestic" placeholder="По одному темплейту в строке"></textarea></label>
                </div>
                <div id="zabbix-tpl-picker" hidden>
                  <div class="zabbix-picker-row">
                    <select id="zabbix-tpl-select" aria-label="Доступные темплейты Zabbix"></select>
                    <select id="zabbix-tpl-target" aria-label="Куда добавить" style="max-width:170px">
                      <option value="templatesCommon">В общие</option>
                      <option value="templatesCash">В кассу</option>
                      <option value="templatesOccasional">В по необходимости</option>
                      <option value="templatesRestic">В Restic</option>
                    </select>
                    <button type="button" id="zabbix-tpl-add">Добавить</button>
                  </div>
                </div>
              </section>
            </div>
            <div class="zabbix-footer">
              <p id="zabbix-settings-status" role="status">Загрузка настроек…</p>
              <button type="button" id="zabbix-test-api">Проверить API и темплейты</button>
              <button type="button" id="zabbix-settings-close">Закрыть</button>
              <button type="button" id="zabbix-save-settings" class="zabbix-primary">Сохранить настройки</button>
            </div>
          </div>
        </form>`;

        document.body.appendChild(d);
        document.getElementById('zabbix-device').textContent = 'Компьютер: ' + (n.name || n._id);

        var self = this;
        var form = d.querySelector('form');
        form.elements.mode.value = 'occasional';
        this.activeTab = 'install';

        Array.from(d.querySelectorAll('.zabbix-tab')).forEach(function (tabBtn) {
          tabBtn.onclick = function () {
            if (self.activeTab === 'settings') self.flushSettingsSave(form, true);
            self.switchTab(tabBtn.dataset.tab);
          };
        });

        form._dirtySettings = {};
        ['apiUrl', 'apiToken', 'autoApplyTemplates', 'templatesCommon', 'templatesCash', 'templatesOccasional', 'templatesRestic'].forEach(function (fieldName) {
          var el = form.elements[fieldName];
          if (!el) return;
          var evt = el.type === 'checkbox' ? 'change' : 'input';
          el.addEventListener(evt, function () {
            form._dirtySettings[fieldName] = true;
            self.queueSettingsSave(form);
          });
        });

        document.getElementById('zabbix-site-name').onclick = function () {
          var value = self.transliterate(n.name || '');
          if (!value) {
            self.status('Не удалось получить название точки.');
            return;
          }
          form.elements.site.value = value;
          self.status('Проверьте название точки.');
        };

        var panel = d.querySelector('.zabbix-log-panel');
        document.getElementById('zabbix-toggle-log').onclick = function () { panel.hidden = !panel.hidden; };
        document.getElementById('zabbix-load-log').onclick = function () { self.readInstallLog(n._id); };

        var closeFn = function () {
          if (self.busy || self.bulk) return;
          self.flushSettingsSave(form, true);
          d.remove();
        };
        document.getElementById('zabbix-close').onclick = closeFn;
        document.getElementById('zabbix-settings-close').onclick = closeFn;

        document.getElementById('zabbix-save-settings').onclick = function () {
          clearTimeout(form._saveTimer);
          form._saveTimer = null;
          self.settingsStatus('Сохранение настроек…');
          try {
            self.send('saveSettings', { settings: self.readSettingsForm(form, false) });
            form._dirtySettings = {};
          } catch (e) {
            self.settingsStatus('Ошибка: ' + e.message);
          }
        };

        document.getElementById('zabbix-clear-token').onclick = function () {
          self.settingsStatus('Удаление токена…');
          self.send('saveSettings', { settings: self.readSettingsForm(form, true) });
        };

        document.getElementById('zabbix-test-api').onclick = function () {
          var reqId = 'test-' + Date.now() + '-' + Math.random().toString(16).slice(2);
          self.pendingTestId = reqId;
          self.settingsStatus('Проверка подключения к Zabbix API…');
          self.send('testZabbixApi', { requestId: reqId, settings: self.readSettingsForm(form, false) });
        };

        document.getElementById('zabbix-tpl-add').onclick = function () {
          var select = document.getElementById('zabbix-tpl-select');
          var targetName = document.getElementById('zabbix-tpl-target').value;
          var targetField = form.elements[targetName];
          if (!select || !select.value || !targetField) return;
          var current = targetField.value.split(/[\r\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
          if (current.indexOf(select.value) === -1) {
            targetField.value = current.concat([select.value]).join('\n');
            form._dirtySettings[targetName] = true;
            self.queueSettingsSave(form);
            self.settingsStatus('Добавлен темплейт "' + select.value + '".');
          } else {
            self.settingsStatus('Темплейт "' + select.value + '" уже есть в списке.');
          }
        };

        try {
          var saved = localStorage.getItem('zabbix-plugin-psk');
          if (saved) {
            form.elements.psk.value = saved;
            form.elements.remember.checked = true;
          }
        } catch (e) {
          self.log('Browser storage is unavailable.');
        }

        form.elements.remember.onchange = function () {
          if (!this.checked) {
            try { localStorage.removeItem('zabbix-plugin-psk'); } catch (e) { self.log('Could not remove saved key.'); }
          }
        };

        form.onsubmit = function (e) {
          e.preventDefault();
          if (self.activeTab !== 'install' || self.busy) return;
          try {
            if (this.elements.remember.checked) localStorage.setItem('zabbix-plugin-psk', this.elements.psk.value);
            else localStorage.removeItem('zabbix-plugin-psk');
          } catch (err) {
            self.status('Browser storage is unavailable; key was not saved.');
            return;
          }
          self.busy = true;
          self.node = n._id;
          self.parts = [];
          self.currentInstallConfig = {
            site: this.elements.site.value,
            mode: this.elements.mode.value,
            restic: this.elements.restic.checked
          };
          self.status('Создание установщика…');
          self.send('build', {
            config: {
              server: this.elements.server.value,
              site: this.elements.site.value,
              psk: this.elements.psk.value,
              mode: this.elements.mode.value,
              restic: this.elements.restic.checked
            }
          });
          this.elements.psk.value = '';
          self.timer = setTimeout(function () { self.fail('Сервер не ответил.'); }, 60000);
        };

        if (this.settingsCache) this.populateSettingsForm(this.settingsCache);
        this.send('loadSettings');
      },

      downloadRemoteText: function (node, remotePath, callback) {
        var redirect, done = false, timer, id = Math.floor(Math.random() * 1000000000), parts = [], size = 0;
        function finish(error, text) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { redirect.Stop(); } catch (e) {}
          callback(error, text);
        }
        function send(m) { redirect.sendText(JSON.stringify(m)); }
        var protocol = CreateRemoteFiles(function (raw) {
          var m = raw;
          try { if (typeof m === 'string') m = JSON.parse(m); } catch (e) { return; }
          if (!m || m.action !== 'download' || String(m.id) !== String(id)) return;
          if (m.sub === 'start') send({ action: 'download', sub: 'startack', id: id });
          else if (m.sub === 'cancel') finish('Журнал установки отсутствует или недоступен. Если передача не началась, журнал установки ещё не создавался.');
        }, function (data) {
          if (done) return;
          var bytes;
          if (typeof data === 'string') {
            bytes = new Uint8Array(data.length);
            for (var i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 255;
          } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
          } else if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          } else return;
          if (bytes.length < 4) { finish('Ошибка чтения журнала установки.'); return; }
          size += bytes.length - 4;
          if (size > 1048576) {
            send({ action: 'download', sub: 'cancel', id: id });
            finish('Журнал установки превышает 1 МБ.');
            return;
          }
          parts.push(bytes.slice(4));
          if (bytes[3] & 1) {
            var content = new Uint8Array(size), offset = 0;
            parts.forEach(function (part) { content.set(part, offset); offset += part.length; });
            finish(null, new TextDecoder('utf-8').decode(content));
          } else send({ action: 'download', sub: 'ack', id: id });
        });
        redirect = CreateAgentRedirect(meshserver, protocol, serverPublicNamePort, authCookie, authRelayCookie, domainUrl);
        redirect.onStateChanged = function (x, state) {
          if (state === 3) send({ action: 'download', sub: 'start', id: id, path: remotePath });
          else if (state === 0 && !done) finish('Файловое соединение для чтения журнала прервано.');
        };
        timer = setTimeout(function () { finish('Превышено время ожидания журнала.'); }, 30000);
        try { redirect.Start(node); } catch (e) { finish('Не удалось открыть журнал: ' + e.message); }
      },

      readInstallLog: function (node) {
        var self = this;
        self.log('Чтение последнего журнала установки с компьютера (он может относиться к предыдущему запуску).');
        this.downloadRemoteText(node, 'C:/zabbix/ZabbixMesh-install.log', function (error, text) {
          if (error) self.log(error);
          else self.log('Последний журнал установки:\n' + text);
        });
      },

      extractHostnameFromLog: function (text) {
        var match = String(text || '').match(/^\s*Host name:\s*(.+?)\s*$/m);
        return match ? match[1].trim() : '';
      },

      applyConfiguredTemplates: function (nodeid, cfg, done) {
        var self = this;
        if (!this.shouldApplyTemplates(cfg)) {
          done('Установка завершена.');
          return;
        }
        self.status('Привязка темплейтов в Zabbix…');
        if (self.bulk && self.bulk.entries && self.bulk.entries[self.bulk.index] && self.bulk.entries[self.bulk.index].result) {
          self.bulk.entries[self.bulk.index].result.textContent = 'Привязка темплейтов в Zabbix…';
        }
        this.downloadRemoteText(nodeid, 'C:/zabbix/ZabbixMesh-install.log', function (err, text) {
          var hostname = err ? '' : self.extractHostnameFromLog(text);
          if (!hostname) {
            self.log('Не удалось определить Host name из журнала для привязки темплейтов.');
            done('Установка завершена, но не удалось определить имя узла для привязки темплейтов.');
            return;
          }
          var reqId = 'apply-' + Date.now() + '-' + Math.random().toString(16).slice(2);
          var timer = setTimeout(function () {
            if (self.pendingApply[reqId]) {
              delete self.pendingApply[reqId];
              done('Установка завершена, но истекло время ожидания Zabbix API.');
            }
          }, 45000);
          self.pendingApply[reqId] = function (m) {
            clearTimeout(timer);
            if (m.error) {
              self.log('Ошибка привязки темплейтов Zabbix: ' + m.error);
              done('Установка завершена, но темплейты не привязаны: ' + m.error);
              return;
            }
            var r = m.applyResult || {};
            if (r.skipped) {
              done('Установка завершена.');
              return;
            }
            var parts = ['Установка завершена. Темплейты для ' + r.hostname + ':'];
            if (r.linked && r.linked.length) parts.push('привязаны (' + r.linked.join(', ') + ')');
            if (r.alreadyLinked && r.alreadyLinked.length) parts.push('уже были (' + r.alreadyLinked.length + ')');
            if (r.missingTemplates && r.missingTemplates.length) parts.push('не найдены в Zabbix: ' + r.missingTemplates.join(', '));
            done(parts.join(' ') + '.');
          };
          self.send('applyTemplates', {
            requestId: reqId,
            hostname: hostname,
            mode: cfg.mode,
            restic: cfg.restic
          });
        });
      },

      openBulk: function () {
        if (document.getElementById('zabbix-dialog')) return;
        if (typeof getCheckedDevices !== 'function' || typeof getNodeFromId !== 'function') {
          alert('Выбор компьютеров MeshCentral недоступен.');
          return;
        }
        var ids = getCheckedDevices(), self = this;
        if (!ids.length) { alert('Выберите компьютеры в списке устройств.'); return; }
        if (ids.length > 100) { alert('Выберите не более 100 компьютеров за один запуск.'); return; }
        var entries = ids.map(function (id) {
          var n = getNodeFromId(id);
          return n ? { node: n, site: self.transliterate(n.name || '') } : null;
        }).filter(Boolean);
        if (entries.length !== ids.length) { alert('Не удалось получить сведения обо всех выбранных компьютерах.'); return; }

        this.open(entries[0].node);
        var dialog = document.getElementById('zabbix-dialog');
        if (!dialog) return;
        var form = dialog.querySelector('form');
        document.getElementById('zabbix-title').textContent = 'Установка Zabbix на несколько компьютеров';
        document.getElementById('zabbix-device').textContent = 'Выбрано компьютеров: ' + entries.length;
        var siteRow = form.elements.site.closest('.zabbix-site-row');
        if (siteRow) siteRow.hidden = true;
        form.elements.site.required = false;
        var journalLoad = document.getElementById('zabbix-load-log');
        if (journalLoad) journalLoad.hidden = true;

        var list = document.createElement('div');
        list.className = 'zabbix-bulk-list';
        entries.forEach(function (item) {
          var row = document.createElement('div'), name = document.createElement('span'), site = document.createElement('span'), result = document.createElement('span'), logButton = document.createElement('button');
          row.className = 'zabbix-bulk-row';
          result.className = 'zabbix-bulk-result';
          name.textContent = item.node.name || item.node._id;
          site.textContent = item.site || 'Не удалось сформировать название';
          result.textContent = 'Ожидает';
          logButton.type = 'button';
          logButton.textContent = 'Журнал компьютера';
          logButton.onclick = function () {
            var panel = dialog.querySelector('.zabbix-log-panel');
            if (panel) panel.hidden = false;
            self.readInstallLog(item.node._id);
          };
          row.appendChild(name);
          row.appendChild(site);
          row.appendChild(result);
          row.appendChild(logButton);
          list.appendChild(row);
          item.result = result;
        });
        dialog.querySelector('[data-view="install"] .zabbix-card').appendChild(list);

        form.onsubmit = function (e) {
          e.preventDefault();
          if (self.activeTab !== 'install' || self.busy || self.bulk) return;
          if (!form.reportValidity()) return;
          if (entries.some(function (x) { return !x.site; })) {
            self.status('Не удалось сформировать название для одного из компьютеров.');
            return;
          }
          try {
            if (form.elements.remember.checked) localStorage.setItem('zabbix-plugin-psk', form.elements.psk.value);
            else localStorage.removeItem('zabbix-plugin-psk');
          } catch (err) {
            self.status('Не удалось сохранить настройки браузера.');
            return;
          }
          self.bulk = {
            entries: entries,
            index: 0,
            config: {
              server: form.elements.server.value,
              psk: form.elements.psk.value,
              mode: form.elements.mode.value,
              restic: form.elements.restic.checked
            }
          };
          form.elements.psk.value = '';
          Array.from(form.elements).forEach(function (el) {
            if (el.id !== 'zabbix-close' && el.id !== 'zabbix-settings-close' && !el.classList.contains('zabbix-tab')) el.disabled = true;
          });
          self.bulkNext();
        };
      },

      bulkNext: function () {
        var b = this.bulk;
        if (!b) return;
        if (b.index >= b.entries.length) {
          var done = b.entries.filter(function (x) { return x.outcome === 'ok'; }).length;
          var unknown = b.entries.filter(function (x) { return x.outcome === 'unknown'; }).length;
          this.bulk = null;
          this.busy = false;
          var f = document.querySelector('#zabbix-dialog form');
          if (f) Array.from(f.elements).forEach(function (el) { el.disabled = false; });
          this.status('Завершено: ' + done + ' из ' + b.entries.length + '; неизвестный результат: ' + unknown + '. Проверьте результаты устройств.');
          return;
        }
        var item = b.entries[b.index];
        if ((item.node.conn & 1) === 0) {
          item.result.textContent = 'Агент не подключён; установка не запускалась.';
          item.outcome = 'failed';
          b.index++;
          this.bulkNext();
          return;
        }
        this.node = item.node._id;
        this.parts = [];
        this.busy = true;
        this.currentInstallConfig = {
          site: item.site,
          mode: b.config.mode,
          restic: b.config.restic
        };
        item.result.textContent = 'Создание пакета…';
        this.status('Компьютер ' + (b.index + 1) + ' из ' + b.entries.length + ': ' + (item.node.name || item.node._id));
        try {
          this.send('build', {
            config: {
              server: b.config.server,
              psk: b.config.psk,
              mode: b.config.mode,
              restic: b.config.restic,
              site: item.site
            }
          });
        } catch (e) {
          this.fail('Не удалось отправить запрос на сервер: ' + e.message);
          return;
        }
        var self = this;
        this.timer = setTimeout(function () { self.fail('Сервер не ответил вовремя.'); }, 60000);
      },

      bulkDone: function (outcome, message) {
        var b = this.bulk;
        if (!b) return;
        var item = b.entries[b.index];
        item.outcome = outcome;
        item.result.textContent = message;
        b.index++;
        this.busy = false;
        var self = this;
        setTimeout(function () { self.bulkNext(); }, 0);
      },

      fail: function (s) {
        clearTimeout(this.timer);
        this.busy = false;
        this.parts = [];
        this.status('Ошибка: ' + s);
        try { this.send('cancel'); } catch (e) {}
        if (this.bulk) this.bulkDone('failed', 'Ошибка: ' + s);
      },

      markInstalled: function (nodeid) {
        var self = this, node = typeof getNodeFromId === 'function' ? getNodeFromId(nodeid) : null;
        if (!node || node._id !== nodeid) {
          self.log('Карточка недоступна: добавьте Zabbix в описание вручную.');
          return;
        }
        var desc = typeof node.desc === 'string' ? node.desc : '';
        if (/(^|[\s,;])zabbix(?=$|[\s,;])/i.test(desc)) {
          self.log('Отметка Zabbix уже есть в описании.');
          return;
        }
        var updated = desc + (desc ? '\n' : '') + 'Zabbix';
        if (updated.length > 1024) {
          self.log('Описание слишком длинное для отметки Zabbix.');
          return;
        }
        try {
          meshserver.send({ action: 'changedevice', nodeid: nodeid, desc: updated });
        } catch (e) {
          self.log('Не удалось отправить отметку в описание: ' + e.message);
          return;
        }
        var started = Date.now();
        var timer = setInterval(function () {
          var current = typeof getNodeFromId === 'function' ? getNodeFromId(nodeid) : null;
          if (current && typeof current.desc === 'string' && /(^|[\s,;])zabbix(?=$|[\s,;])/i.test(current.desc)) {
            clearInterval(timer);
            self.log('В описание добавлена отметка Zabbix.');
          } else if (Date.now() - started > 15000) {
            clearInterval(timer);
            self.log('Обновление описания не подтверждено за 15 сек.');
          }
        }, 500);
      },

      chunk: function (m) {
        if (!this.busy) return;
        if (m.error) { this.fail(m.error); return; }
        if (m.ready) { this.send('next'); return; }
        if (typeof m.data !== 'string') { this.fail('Некорректный ответ сервера.'); return; }
        var s = atob(m.data), a = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
        this.parts.push(a);
        this.status('Получение пакета: ' + Math.round(100 * m.offset / m.total) + '%');
        if (!m.done) { this.send('next'); return; }
        clearTimeout(this.timer);
        var f = new Blob(this.parts, { type: 'application/octet-stream' });
        this.parts = [];
        this.prepare(f);
      },

      prepare: function (file) {
        var self = this, dir = 'C:/Windows/System32/config/systemprofile/AppData/Local/Temp';
        var id = Array.from(crypto.getRandomValues(new Uint8Array(16)), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
        var prefix = 'zabbix-prepare-' + id, redirect, timer, interval, ended = false;
        function finish(err) {
          if (ended) return;
          ended = true;
          clearTimeout(timer);
          clearInterval(interval);
          try { redirect.Stop(); } catch (e) {}
          if (err) self.fail(err);
          else self.upload(file);
        }
        function query() {
          try { redirect.sendText(JSON.stringify({ action: 'ls', reqid: 71, path: dir })); }
          catch (e) { finish('Не удалось проверить подготовку папки.'); }
        }
        var script = "$m='" + dir.replace(/\//g, '\\') + '\\' + prefix + "';try{New-Item -ItemType Directory -Path 'C:\\zabbix' -Force -ErrorAction Stop | Out-Null;New-Item -ItemType File -Path ($m+'.ok') -Force | Out-Null}catch{New-Item -ItemType File -Path ($m+'.failed') -Force | Out-Null}";
        var encoded = btoa(unescape(encodeURIComponent(script)).split('').map(function (c) { return c + '\0'; }).join(''));
        var protocol = CreateRemoteFiles(function (raw) {
          var m = raw;
          try { if (typeof m === 'string') m = JSON.parse(m); } catch (e) { return; }
          if (!m || Number(m.reqid) !== 71 || !Array.isArray(m.dir)) return;
          var hit = m.dir.find(function (x) { return x.n === prefix + '.ok' || x.n === prefix + '.failed'; });
          if (!hit) return;
          try { redirect.sendText(JSON.stringify({ action: 'rm', reqid: 72, path: dir, delfiles: [hit.n], rec: false })); } catch (e) {}
          finish(/\.ok$/.test(hit.n) ? null : 'Не удалось создать C:\\zabbix на компьютере.');
        });
        redirect = CreateAgentRedirect(meshserver, protocol, serverPublicNamePort, authCookie, authRelayCookie, domainUrl);
        redirect.onStateChanged = function (x, state) {
          if (state === 3) {
            try {
              meshserver.send({ action: 'runcommands', nodeids: [self.node], type: 1, runAsUser: 0, cmds: 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + encoded });
              query();
              interval = setInterval(query, 2000);
            } catch (e) {
              finish('Не удалось отправить команду подготовки: ' + e.message);
            }
          } else if (state === 0 && !ended) {
            finish('Файловое соединение прервано при подготовке папки.');
          }
        };
        self.status('Подготовка папки C:\\zabbix…');
        timer = setTimeout(function () { finish('Не удалось получить результат подготовки C:\\zabbix. Проверьте права выполнения команд.'); }, 60000);
        try { redirect.Start(self.node); } catch (e) { finish(e.message); }
      },

      upload: function (file) {
        var self = this, dir = 'C:/zabbix';
        var id = Array.from(crypto.getRandomValues(new Uint8Array(16)), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
        var name = 'zabbix-' + id + '.exe', offset = 0, done = false, redirect, timer;
        function finish(err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (err) {
            try { redirect.sendText(JSON.stringify({ action: 'rm', reqid: 9, path: dir, delfiles: [name], rec: false })); } catch (e) {}
          }
          try { redirect.Stop(); } catch (e) {}
          if (err) self.fail(err);
          else self.run(dir, name, id);
        }
        function touch() {
          clearTimeout(timer);
          timer = setTimeout(function () { finish('Превышено время передачи файла.'); }, 60000);
        }
        function next() {
          if (offset >= file.size) { redirect.sendText(JSON.stringify({ action: 'uploaddone', reqid: 1 })); return; }
          var reader = new FileReader();
          reader.onerror = function () { finish('Не удалось прочитать пакет.'); };
          reader.onload = function () {
            var bytes = new Uint8Array(reader.result);
            if (bytes.length && (bytes[0] === 0 || bytes[0] === 123)) {
              var frame = new Uint8Array(bytes.length + 1);
              frame.set(bytes, 1);
              redirect.send(frame);
            } else redirect.send(bytes);
            offset += bytes.length;
            self.status('Передача на компьютер: ' + Math.round(offset * 100 / file.size) + '%');
            touch();
          };
          reader.readAsArrayBuffer(file.slice(offset, Math.min(offset + 65536, file.size)));
        }
        self.log('Передача: папка ' + dir + ', размер ' + file.size + ' байт.');
        var protocol = CreateRemoteFiles(function (data) {
          var m = data;
          try { if (typeof m === 'string') m = JSON.parse(m); } catch (e) { return; }
          if (!m || Number(m.reqid) !== 1) return;
          touch();
          if (m.action === 'uploadstart') { self.log('Агент начал запись файла.'); next(); }
          else if (m.action === 'uploadack') next();
          else if (m.action === 'uploaddone') { self.log('Передача файла завершена.'); finish(); }
          else if (m.action === 'uploaderror') {
            var detail = ['error', 'message', 'code', 'reason'].map(function (k) {
              return typeof m[k] === 'string' || typeof m[k] === 'number' ? k + ': ' + String(m[k]).slice(0, 500) : '';
            }).filter(Boolean).join('; ');
            self.log('Ответ файлового агента: uploaderror' + (detail ? ' — ' + detail : '; описание ошибки агент не предоставил.'));
            finish('Агент не смог записать пакет. Откройте журнал.');
          }
        });
        redirect = CreateAgentRedirect(meshserver, protocol, serverPublicNamePort, authCookie, authRelayCookie, domainUrl);
        redirect.onStateChanged = function (x, state) {
          if (state === 3) {
            touch();
            redirect.sendText(JSON.stringify({ action: 'upload', reqid: 1, path: dir, name: name, size: file.size }));
          } else if (state === 0 && !done) {
            finish('Файловое соединение прервано.');
          }
        };
        touch();
        try { redirect.Start(self.node); } catch (e) { finish(e.message); }
      },

      run: function (dir, name, id) {
        var self = this;
        self.status('Установщик передан. Выполняется установка…');
        var exe = (dir + '/' + name).replace(/\//g, '\\'), marker = (dir + '/zabbix-' + id).replace(/\//g, '\\');
        var script = "$p='" + exe + "';$m='" + marker + "';$l=Join-Path (Split-Path $p) 'ZabbixMesh-install.log';$o=$m+'.out';$e=$m+'.err';$c=1;$t='Installation started: '+(Get-Date).ToString('s')+[Environment]::NewLine;try{$proc=Start-Process -FilePath $p -Wait -PassThru -NoNewWindow -RedirectStandardOutput $o -RedirectStandardError $e;$c=$proc.ExitCode;$t+='Exit code: '+$c+[Environment]::NewLine;foreach($f in @($o,$e)){if(Test-Path -LiteralPath $f){$t+=[IO.File]::ReadAllText($f,[Text.Encoding]::Default)+[Environment]::NewLine}}}catch{$t+='Error: '+($_ | Out-String)}finally{[IO.File]::WriteAllText($l,$t,[Text.Encoding]::UTF8);Remove-Item -LiteralPath $p,$o,$e -Force -ErrorAction SilentlyContinue};if($c -eq 0){New-Item -ItemType File -Force -Path ($m+'.ok') | Out-Null}else{New-Item -ItemType File -Force -Path ($m+'.failed') | Out-Null}";
        var encoded = btoa(unescape(encodeURIComponent(script)).split('').map(function (c) { return c + '\0'; }).join(''));
        try {
          meshserver.send({ action: 'runcommands', nodeids: [self.node], type: 1, runAsUser: 0, cmds: 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + encoded });
        } catch (e) {
          self.fail(e.message);
          return;
        }
        var redirect, ended = false, start = Date.now(), interval, timer;
        function finish(msg, outcome) {
          if (ended) return;
          ended = true;
          clearInterval(interval);
          clearTimeout(timer);
          try { redirect.Stop(); } catch (e) {}
          self.busy = false;
          self.status(msg);
          if (self.bulk) self.bulkDone(outcome || 'unknown', msg);
        }
        function query() {
          if (Date.now() - start > 900000) {
            finish('Результат неизвестен: время ожидания истекло. Проверьте журнал ZabbixMesh-install.log.');
            return;
          }
          try { redirect.sendText(JSON.stringify({ action: 'ls', reqid: 2, path: dir })); }
          catch (e) { finish('Результат неизвестен: файловое соединение прервано.'); }
        }
        var protocol = CreateRemoteFiles(function (data) {
          var m = data;
          try { if (typeof m === 'string') m = JSON.parse(m); } catch (e) { return; }
          if (!m || Number(m.reqid) !== 2 || !Array.isArray(m.dir)) return;
          var hit = m.dir.find(function (x) { return x.n === 'zabbix-' + id + '.ok' || x.n === 'zabbix-' + id + '.failed'; });
          if (!hit) return;
          try { redirect.sendText(JSON.stringify({ action: 'rm', reqid: 3, path: dir, delfiles: [hit.n], rec: false })); } catch (e) {}
          var success = /\.ok$/.test(hit.n), nodeid = self.node, cfg = self.currentInstallConfig;
          if (!success) {
            finish('Ошибка установки. Проверьте журнал ZabbixMesh-install.log в папке C:\\zabbix.', 'failed');
            return;
          }
          self.markInstalled(nodeid);
          if (self.shouldApplyTemplates(cfg)) {
            ended = true;
            clearInterval(interval);
            clearTimeout(timer);
            try { redirect.Stop(); } catch (e) {}
            self.applyConfiguredTemplates(nodeid, cfg, function (finalMsg) {
              self.busy = false;
              self.status(finalMsg);
              if (self.bulk) self.bulkDone('ok', finalMsg);
            });
          } else {
            finish('Установка завершена.', 'ok');
          }
        });
        redirect = CreateAgentRedirect(meshserver, protocol, serverPublicNamePort, authCookie, authRelayCookie, domainUrl);
        redirect.onStateChanged = function (x, state) {
          if (state === 3) {
            clearTimeout(timer);
            query();
            interval = setInterval(query, 5000);
          } else if (state === 0 && !ended) {
            finish('Результат неизвестен: файловое соединение прервано.');
          }
        };
        timer = setTimeout(function () { finish('Результат неизвестен: не удалось подключить файловый канал.'); }, 30000);
        try { redirect.Start(self.node); } catch (e) { finish('Результат неизвестен: ' + e.message); }
      }
    };
    window.ZabbixPlugin.inject();
    setInterval(function () { if (window.ZabbixPlugin) window.ZabbixPlugin.inject(); }, 3000);
  };

  obj.onDeviceRefreshEnd = function () { if (window.ZabbixPlugin) window.ZabbixPlugin.inject(); };
  obj.onPackageChunk = function (server, message) { if (window.ZabbixPlugin) window.ZabbixPlugin.chunk(message || server); };
  obj.onSettings = function (server, message) { if (window.ZabbixPlugin) window.ZabbixPlugin.onSettingsMessage(message || server); };
  return obj;
};
module.exports.zabbix = module.exports;
