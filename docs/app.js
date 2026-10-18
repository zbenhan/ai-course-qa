/**
 * AI 使用分享 · 现场提问与投票 —— 前端逻辑
 * 纯原生 JS，无构建步骤，直接部署到 GitHub Pages。
 */
(function () {
  'use strict';

  var cfg = window.APP_CONFIG || {};
  var API_BASE = String(cfg.API_BASE || '').replace(/\/+$/, '');
  var MAX_VOTES = Number(cfg.MAX_VOTES || 3);
  var REFRESH_MS = Math.max(2000, Number(cfg.REFRESH_MS || 5000));
  var IS_CONFIGURED = /^https?:\/\//.test(API_BASE) && !API_BASE.includes('your-domain') && !API_BASE.includes('example.com');

  var STORAGE_DEVICE = 'aiqa_device_id';
  var STORAGE_ADMIN = 'aiqa_admin_token';

  var state = {
    questions: [],
    stats: null,
    sort: 'hot',
    loading: false,
    lastError: '',
  };

  var el = {};

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }

  function simpleHash(str) {
    var h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var i = 0; i < str.length; i++) {
      h1 ^= str.charCodeAt(i);
      h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + str.charCodeAt(i) * (i + 7)) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  async function sha256(str) {
    try {
      if (window.crypto && crypto.subtle) {
        var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      }
    } catch (e) { /* 降级到简单哈希 */ }
    return simpleHash(str);
  }

  /** 设备指纹 + 本地记录：同一设备/浏览器共用一个 ID，服务端据此限制票数 */
  async function getDeviceId() {
    var stored = null;
    try { stored = window.localStorage.getItem(STORAGE_DEVICE); } catch (e) { stored = null; }
    if (stored) return stored;

    var parts = [
      navigator.userAgent || '',
      navigator.language || '',
      (screen.width || 0) + 'x' + (screen.height || 0) + 'x' + (screen.colorDepth || 0),
      String(new Date().getTimezoneOffset()),
      String(navigator.hardwareConcurrency || 0),
      String(navigator.maxTouchPoints || 0),
      String(Math.random()),
    ].join('|');

    var id = 'd' + (await sha256(parts)).slice(0, 24);
    try { window.localStorage.setItem(STORAGE_DEVICE, id); } catch (e) { /* 隐私模式忽略 */ }
    return id;
  }

  function toast(msg, isError) {
    var node = document.createElement('div');
    node.className = 'toast' + (isError ? ' is-error' : '');
    node.textContent = msg;
    document.body.appendChild(node);
    requestAnimationFrame(function () { node.classList.add('is-show'); });
    setTimeout(function () {
      node.classList.remove('is-show');
      setTimeout(function () { node.remove(); }, 250);
    }, 2200);
  }

  function showError(msg) {
    if (!msg) {
      el.errorBanner.hidden = true;
      el.errorBanner.textContent = '';
      return;
    }
    el.errorBanner.hidden = false;
    el.errorBanner.textContent = msg;
  }

  function timeAgo(ts) {
    var diff = Math.max(0, Date.now() - ts);
    var min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    var hour = Math.floor(min / 60);
    if (hour < 24) return hour + ' 小时前';
    return Math.floor(hour / 24) + ' 天前';
  }

  // ---------- 接口 ----------
  async function api(path, options) {
    var opts = options || {};
    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {}
    );
    headers['x-device-id'] = await getDeviceId();

    var res = await fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok) {
      var err = new Error((data && data.message) || ('请求失败（' + res.status + '）'));
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  // ---------- 渲染 ----------
  function renderStats(data) {
    state.stats = data.stats || null;
    var s = state.stats;
    if (!s) return;
    el.remainingVotes.textContent = s.remainingVotes;
    el.statsText.textContent = s.questionCount + ' 个问题 · ' + s.voteCount + ' 次投票 · ' + s.voterCount + ' 人参与';
    el.maxVotesText.textContent = String(s.maxVotesPerDevice || MAX_VOTES);
  }

  function sortedQuestions() {
    var list = state.questions.slice();
    if (state.sort === 'hot') {
      list.sort(function (a, b) { return b.votes - a.votes || a.createdAt - b.createdAt; });
    } else {
      list.sort(function (a, b) { return b.createdAt - a.createdAt; });
    }
    return list;
  }

  function buildQuestionItem(q, index) {
    var li = document.createElement('li');
    li.className = 'question';
    if (q.mine) li.classList.add('is-mine');
    if (index < 3 && q.votes > 0) li.classList.add('is-top');

    var rank = document.createElement('div');
    rank.className = 'rank' + (index < 3 && q.votes > 0 ? ' is-top' : '');
    rank.textContent = String(index + 1);

    var body = document.createElement('div');
    body.className = 'q-body';
    var text = document.createElement('p');
    text.className = 'q-text';
    text.textContent = q.text;
    var meta = document.createElement('p');
    meta.className = 'q-meta';
    meta.textContent = '来自 ' + q.author + ' · ' + timeAgo(q.createdAt) + (q.mine ? ' · 我提的' : '');
    body.appendChild(text);
    body.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'q-actions';

    var votes = document.createElement('div');
    votes.className = 'q-votes';
    votes.appendChild(document.createTextNode(String(q.votes)));
    var unit = document.createElement('small');
    unit.textContent = '票';
    votes.appendChild(unit);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-vote btn-sm';
    if (q.voted) {
      btn.classList.add('is-voted');
      btn.textContent = '已投票';
      btn.disabled = true;
    } else {
      btn.textContent = '投一票';
      btn.disabled = !IS_CONFIGURED || (state.stats ? state.stats.remainingVotes <= 0 : false);
      if (btn.disabled && state.stats && state.stats.remainingVotes <= 0) btn.textContent = '票已用完';
      btn.addEventListener('click', function () { vote(q.id, btn); });
    }

    actions.appendChild(votes);
    actions.appendChild(btn);

    var adminToken = getAdminToken();
    if (adminToken) {
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-delete';
      del.textContent = '删除';
      del.addEventListener('click', function () { removeQuestion(q.id); });
      actions.appendChild(del);
    }

    li.appendChild(rank);
    li.appendChild(body);
    li.appendChild(actions);
    return li;
  }

  function renderQuestions() {
    var list = sortedQuestions();
    el.questionList.textContent = '';
    if (!list.length) {
      el.emptyHint.hidden = false;
      return;
    }
    el.emptyHint.hidden = true;
    var frag = document.createDocumentFragment();
    list.forEach(function (q, i) { frag.appendChild(buildQuestionItem(q, i)); });
    el.questionList.appendChild(frag);
  }

  function renderDownloads() {
    var items = Array.isArray(cfg.COURSEWARE) ? cfg.COURSEWARE : [];
    el.downloadList.textContent = '';
    if (!items.length) {
      el.downloadEmpty.hidden = false;
      return;
    }
    el.downloadEmpty.hidden = true;
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'download-item';

      var info = document.createElement('div');
      var title = document.createElement('p');
      title.className = 'download-title';
      title.textContent = item.title || '课程课件';
      info.appendChild(title);
      if (item.desc) {
        var desc = document.createElement('p');
        desc.className = 'download-desc';
        desc.textContent = item.desc;
        info.appendChild(desc);
      }

      var link = document.createElement('a');
      link.className = 'download-link';
      link.href = item.url;
      link.setAttribute('download', '');
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = '下载';

      li.appendChild(info);
      li.appendChild(link);
      el.downloadList.appendChild(li);
    });
  }

  function setSync(ok, text) {
    el.syncDot.className = 'sync-dot' + (ok ? ' is-ok' : ' is-err');
    el.syncText.textContent = text;
  }

  // ---------- 行为 ----------
  async function refresh(showSpinner) {
    if (!IS_CONFIGURED || state.loading) return;
    state.loading = true;
    if (showSpinner) setSync(false, '同步中…');
    try {
      var data = await api('/api/questions');
      state.questions = data.questions || [];
      renderStats(data);
      renderQuestions();
      showError('');
      setSync(true, '已同步 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (err) {
      setSync(false, '同步失败');
      showError('无法连接后端接口：' + err.message + '。请检查 config.js 中的 API_BASE 是否为可访问的 https 地址。');
    } finally {
      state.loading = false;
    }
  }

  async function vote(questionId, btn) {
    btn.disabled = true;
    try {
      await api('/api/votes', { method: 'POST', body: { questionId: questionId } });
      toast('投票成功');
      await refresh(false);
    } catch (err) {
      var payload = err.payload || {};
      if (payload.error === 'vote_limit_reached' || payload.error === 'already_voted') {
        toast(payload.message || '投票未生效', true);
        await refresh(false);
      } else {
        toast(err.message, true);
        btn.disabled = false;
      }
    }
  }

  async function submitQuestion(event) {
    event.preventDefault();
    var text = el.textInput.value.trim();
    var author = el.authorInput.value.trim();
    if (text.length < 2) {
      toast('问题内容请至少写 2 个字', true);
      return;
    }
    el.askSubmit.disabled = true;
    el.askSubmit.textContent = '提交中…';
    try {
      await api('/api/questions', { method: 'POST', body: { text: text, author: author } });
      el.textInput.value = '';
      el.textCounter.textContent = '0 / 200';
      toast('已提交，感谢提问');
      state.sort = 'new';
      syncTabs();
      await refresh(false);
    } catch (err) {
      toast(err.message, true);
    } finally {
      el.askSubmit.disabled = false;
      el.askSubmit.textContent = '提交问题';
    }
  }

  async function removeQuestion(id) {
    var token = getAdminToken();
    if (!token) return;
    try {
      var res = await fetch(API_BASE + '/api/questions/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { 'x-admin-token': token, 'x-device-id': await getDeviceId() },
      });
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) throw new Error((data && data.message) || '删除失败');
      toast('已删除');
      await refresh(false);
    } catch (err) {
      toast(err.message, true);
    }
  }

  function getAdminToken() {
    try { return window.sessionStorage.getItem(STORAGE_ADMIN) || ''; } catch (e) { return ''; }
  }

  function toggleAdmin() {
    if (getAdminToken()) {
      try { window.sessionStorage.removeItem(STORAGE_ADMIN); } catch (e) { /* ignore */ }
      toast('已退出管理员模式');
      renderQuestions();
      return;
    }
    var token = window.prompt('请输入管理员令牌（对应后端 ADMIN_TOKEN）：');
    if (!token) return;
    try { window.sessionStorage.setItem(STORAGE_ADMIN, token.trim()); } catch (e) { /* ignore */ }
    toast('已进入管理员模式，可删除问题');
    renderQuestions();
  }

  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.classList.toggle('is-active', tab.dataset.sort === state.sort);
    });
  }

  function setupQr() {
    var url = location.origin + location.pathname;
    el.siteUrl.textContent = url;
    el.qrImg.addEventListener('error', function () {
      el.qrImg.dataset.missing = '1';
      el.qrTip.textContent = '二维码待生成（见 README）';
    });
    el.copyLinkBtn.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(url);
        toast('链接已复制');
      } catch (e) {
        window.prompt('请手动复制链接：', url);
      }
    });
  }

  function setupConfigState() {
    el.maxVotesText.textContent = String(MAX_VOTES);
    el.remainingVotes.textContent = String(MAX_VOTES);
    if (!IS_CONFIGURED) {
      el.configBanner.hidden = false;
      el.configBannerText.textContent = '请先在 docs/config.js 里把 API_BASE 改成 VPS 上的接口地址（https://…）。当前为只读演示状态。';
      el.askSubmit.disabled = true;
      setSync(false, '未配置接口');
    }
  }

  function init() {
    el = {
      qrImg: $('qrImg'),
      qrTip: $('qrTip'),
      siteUrl: $('siteUrl'),
      copyLinkBtn: $('copyLinkBtn'),
      configBanner: $('configBanner'),
      configBannerText: $('configBannerText'),
      errorBanner: $('errorBanner'),
      maxVotesText: $('maxVotesText'),
      remainingVotes: $('remainingVotes'),
      askForm: $('askForm'),
      askSubmit: $('askSubmit'),
      authorInput: $('authorInput'),
      textInput: $('textInput'),
      textCounter: $('textCounter'),
      questionList: $('questionList'),
      emptyHint: $('emptyHint'),
      statsText: $('statsText'),
      syncDot: $('syncDot'),
      syncText: $('syncText'),
      refreshBtn: $('refreshBtn'),
      downloadList: $('downloadList'),
      downloadEmpty: $('downloadEmpty'),
      adminToggle: $('adminToggle'),
    };

    setupQr();
    setupConfigState();
    renderDownloads();
    syncTabs();

    el.askForm.addEventListener('submit', submitQuestion);
    el.refreshBtn.addEventListener('click', function () { refresh(true); });
    el.adminToggle.addEventListener('click', toggleAdmin);
    el.textInput.addEventListener('input', function () {
      el.textCounter.textContent = el.textInput.value.length + ' / 200';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () {
        state.sort = tab.dataset.sort;
        syncTabs();
        renderQuestions();
      });
    });

    // 方便本地联调：访问 index.html?api=http://localhost:8787 可临时覆盖接口地址
    var override = new URLSearchParams(location.search).get('api');
    if (override) {
      API_BASE = override.replace(/\/+$/, '');
      IS_CONFIGURED = true;
      el.configBanner.hidden = true;
      el.askSubmit.disabled = false;
    }

    if (IS_CONFIGURED) refresh(true);

    setInterval(function () {
      if (document.visibilityState === 'visible') refresh(false);
    }, REFRESH_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
