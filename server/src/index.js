/**
 * AI 使用分享 · 现场提问与投票 —— 后端接口服务
 *
 * 设计目标：零依赖（只用 Node 内置模块），方便直接扔到 VPS 上跑。
 * 运行要求：Node.js >= 18
 * 数据存储：JSON 文件（写入采用「临时文件 + 原子重命名」，单进程串行写，不会丢数据）
 *
 * 接口一览：
 *   GET    /api/health                    健康检查
 *   GET    /api/questions                 问题列表（含票数、当前设备的剩余票数）
 *   POST   /api/questions                 提交问题  { text, author }
 *   POST   /api/votes                     投票      { questionId }
 *   DELETE /api/questions/:id             删除问题（需管理员令牌）
 *
 * 所有写接口都需要请求头  x-device-id（前端自动生成），用于限制「每设备最多 N 票」。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 配置（全部可用环境变量覆盖） ----------
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();
const MAX_VOTES = Math.max(1, Number(process.env.MAX_VOTES_PER_DEVICE || 3));
const RATE_LIMIT_PER_MIN = Math.max(5, Number(process.env.RATE_LIMIT_PER_MIN || 30));
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LOG_REQUESTS = process.env.LOG_REQUESTS !== '0';

const MAX_QUESTION_LEN = 200;
const MAX_AUTHOR_LEN = 20;
const MAX_QUESTION_COUNT = 500;
const MAX_BODY_BYTES = 8 * 1024;

// ---------- 数据层 ----------
let db = { questions: [], votes: [] };

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db = {
      questions: Array.isArray(raw.questions) ? raw.questions : [],
      votes: Array.isArray(raw.votes) ? raw.votes : [],
    };
  } catch (err) {
    const backup = `${DATA_FILE}.corrupt-${Date.now()}`;
    fs.renameSync(DATA_FILE, backup);
    console.error(`[warn] 数据文件解析失败，已备份到 ${backup}：${err.message}`);
    db = { questions: [], votes: [] };
  }
}

function saveDb() {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- 工具函数 ----------
const voteCountOf = (questionId) => db.votes.filter((v) => v.questionId === questionId).length;
const votesByDevice = (deviceId) => db.votes.filter((v) => v.deviceId === deviceId).length;
const remainingFor = (deviceId) => (deviceId ? Math.max(0, MAX_VOTES - votesByDevice(deviceId)) : MAX_VOTES);

function normalizeDeviceId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return '';
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : '';
}

function cleanText(value, maxLen) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLen) : '';
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function corsHeaders(origin) {
  if (ALLOWED_ORIGINS.includes('*')) return { 'Access-Control-Allow-Origin': '*' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }
  return {};
}

function send(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

// 简易限流：单 IP 每分钟 N 次
const rateHits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const recent = (rateHits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  rateHits.set(ip, recent);
  if (rateHits.size > 5000) rateHits.clear();
  return recent.length > RATE_LIMIT_PER_MIN;
}

function publicQuestion(q, deviceId) {
  return {
    id: q.id,
    text: q.text,
    author: q.author,
    votes: voteCountOf(q.id),
    createdAt: q.createdAt,
    mine: deviceId ? q.deviceId === deviceId : false,
    voted: deviceId ? db.votes.some((v) => v.questionId === q.id && v.deviceId === deviceId) : false,
  };
}

function sortQuestions(list) {
  return list.sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt);
}

function stats(deviceId) {
  return {
    questionCount: db.questions.length,
    voteCount: db.votes.length,
    voterCount: new Set(db.votes.map((v) => v.deviceId)).size,
    maxVotesPerDevice: MAX_VOTES,
    remainingVotes: remainingFor(deviceId),
  };
}

// ---------- 路由处理 ----------
async function handle(req, res, url, cors) {
  const deviceId = normalizeDeviceId(req.headers['x-device-id']);
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (p === '/' || p === '/api') {
    return send(
      res,
      200,
      {
        ok: true,
        service: 'ai-course-qa',
        message: 'AI 使用分享 · 现场提问与投票接口',
        endpoints: ['GET /api/health', 'GET /api/questions', 'POST /api/questions', 'POST /api/votes'],
      },
      cors,
    );
  }

  if (p === '/api/health') {
    return send(
      res,
      200,
      {
        ok: true,
        questions: db.questions.length,
        votes: db.votes.length,
        uptimeSeconds: Math.round(process.uptime()),
        time: new Date().toISOString(),
      },
      cors,
    );
  }

  if (p === '/api/questions' && req.method === 'GET') {
    const questions = sortQuestions(db.questions.map((q) => publicQuestion(q, deviceId)));
    return send(res, 200, { ok: true, questions, stats: stats(deviceId) }, cors);
  }

  if (p === '/api/questions' && req.method === 'POST') {
    const body = await readJson(req);
    const text = cleanText(body.text, MAX_QUESTION_LEN);
    const author = cleanText(body.author, MAX_AUTHOR_LEN) || '匿名听众';
    if (text.length < 2) {
      return send(res, 400, { ok: false, error: 'invalid_text', message: '问题内容太短，请至少写 2 个字' }, cors);
    }
    if (!deviceId) {
      return send(res, 400, { ok: false, error: 'missing_device_id', message: '缺少设备标识，请刷新页面重试' }, cors);
    }
    if (db.questions.length >= MAX_QUESTION_COUNT) {
      return send(res, 429, { ok: false, error: 'too_many_questions', message: '问题数量已达上限' }, cors);
    }
    const question = {
      id: `q_${crypto.randomUUID().slice(0, 8)}`,
      text,
      author,
      deviceId,
      createdAt: Date.now(),
    };
    db.questions.push(question);
    saveDb();
    return send(res, 201, { ok: true, question: publicQuestion(question, deviceId), stats: stats(deviceId) }, cors);
  }

  if (p === '/api/votes' && req.method === 'POST') {
    const body = await readJson(req);
    const questionId = cleanText(body.questionId, 64);
    if (!deviceId) {
      return send(res, 400, { ok: false, error: 'missing_device_id', message: '缺少设备标识，请刷新页面重试' }, cors);
    }
    const question = db.questions.find((q) => q.id === questionId);
    if (!question) {
      return send(res, 404, { ok: false, error: 'question_not_found', message: '该问题不存在或已被删除' }, cors);
    }
    if (db.votes.some((v) => v.questionId === questionId && v.deviceId === deviceId)) {
      return send(res, 409, { ok: false, error: 'already_voted', message: '你已经给这个问题投过票了', stats: stats(deviceId) }, cors);
    }
    if (votesByDevice(deviceId) >= MAX_VOTES) {
      return send(
        res,
        409,
        {
          ok: false,
          error: 'vote_limit_reached',
          message: `每人最多只能投 ${MAX_VOTES} 票，你已用完`,
          stats: stats(deviceId),
        },
        cors,
      );
    }
    db.votes.push({ questionId, deviceId, createdAt: Date.now() });
    saveDb();
    return send(
      res,
      200,
      { ok: true, questionId, votes: voteCountOf(questionId), stats: stats(deviceId) },
      cors,
    );
  }

  const deleteMatch = p.match(/^\/api\/questions\/([A-Za-z0-9_-]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const token = String(req.headers['x-admin-token'] || '').trim();
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      return send(res, 401, { ok: false, error: 'unauthorized', message: '管理员令牌不正确' }, cors);
    }
    const id = deleteMatch[1];
    const before = db.questions.length;
    db.questions = db.questions.filter((q) => q.id !== id);
    db.votes = db.votes.filter((v) => v.questionId !== id);
    if (db.questions.length === before) {
      return send(res, 404, { ok: false, error: 'question_not_found', message: '该问题不存在' }, cors);
    }
    saveDb();
    return send(res, 200, { ok: true, deleted: id, stats: stats(deviceId) }, cors);
  }

  return send(res, 404, { ok: false, error: 'not_found', message: '接口不存在' }, cors);
}

// ---------- 启动 ----------
loadDb();

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...cors,
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Device-Id,X-Admin-Token',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return send(res, 400, { ok: false, error: 'bad_request' }, cors);
  }

  if (LOG_REQUESTS) {
    console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${clientIp(req)}`);
  }

  if (isRateLimited(clientIp(req))) {
    return send(res, 429, { ok: false, error: 'rate_limited', message: '请求过于频繁，请稍后再试' }, cors);
  }

  try {
    await handle(req, res, url, cors);
  } catch (err) {
    if (err.message === 'payload_too_large') {
      return send(res, 413, { ok: false, error: 'payload_too_large', message: '请求内容过大' }, cors);
    }
    if (err.message === 'invalid_json') {
      return send(res, 400, { ok: false, error: 'invalid_json', message: '请求格式不正确' }, cors);
    }
    console.error('[error]', err);
    return send(res, 500, { ok: false, error: 'internal_error', message: '服务内部错误' }, cors);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`✅ 接口服务已启动: http://${HOST}:${PORT}`);
  console.log(`   数据文件: ${DATA_FILE}`);
  console.log(`   每设备最大票数: ${MAX_VOTES}`);
  console.log(`   允许来源: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`   管理员令牌: ${ADMIN_TOKEN ? '已配置' : '未配置（无法删除问题）'}`);
});
