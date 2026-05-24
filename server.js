const https = require('https');
const http = require('http');
const PORT = process.env.PORT || 3000;

const CASSO_KEY = 'AK_CS.f08c2850570b11f1ad2d7bbf51f870c4.G1wgASaEJDydIqbLV11DlEelbBLyF095lWEEDZmyMDyJ8Iv4nkb5JzoMvg45WRI03VPj4RGB';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function request(hostname, path, method, body, headers = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname, path, method, timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (data) req.write(data);
    req.end();
  });
}

function extractName(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const KEYS = ['accountName','ownerName','name','fullName','holderName',
    'creditAccountName','beneficiaryName','receiverName','customerName','acctName'];
  const q = [obj];
  while (q.length) {
    const node = q.shift();
    if (!node || typeof node !== 'object') continue;
    for (const k of Object.keys(node)) {
      if (KEYS.some(nk => k.toLowerCase() === nk.toLowerCase())) {
        const v = node[k];
        if (v && typeof v === 'string' && v.trim().length > 1 && !/^\d+$/.test(v.trim()))
          return v.trim().toUpperCase();
      }
      if (node[k] && typeof node[k] === 'object') q.push(node[k]);
    }
  }
  return null;
}

// ── API 1: Casso (VietQR chính thức) ─────────────────────────────────────
async function tryCasso(bin, acc) {
  const r = await request('api.casso.vn', '/v2/bank-account/lookup', 'POST',
    { bin, accountNumber: acc },
    { 'Authorization': `Apikey ${CASSO_KEY}` }
  );
  if (!r) return null;
  console.log('Casso:', r.status, JSON.stringify(r.body).slice(0,100));
  const name = extractName(r.body);
  if (name) return { name, source: 'VietQR' };
  return null;
}

// ── API 2: VietQR với key ─────────────────────────────────────────────────
async function tryVietQR(bin, acc) {
  const r = await request('api.vietqr.io', '/v2/lookup', 'POST',
    { bin, accountNumber: acc },
    { 'Authorization': `Apikey ${CASSO_KEY}` }
  );
  if (!r) return null;
  console.log('VietQR:', r.status, JSON.stringify(r.body).slice(0,100));
  const name = extractName(r.body);
  if (name && r.body?.code === '00') return { name, source: 'VietQR' };
  return null;
}

// ── API 3: MBBank ─────────────────────────────────────────────────────────
async function tryMBBank(bin, acc) {
  const r = await request(
    'api.mbbank.com.vn',
    '/api/retail-web-internetbankingms/v2.0/transfer/inquiryAccountName',
    'POST', { creditAccount: acc, creditBankId: bin },
    { Referer: 'https://online.mbbank.com.vn/', Origin: 'https://online.mbbank.com.vn' }
  );
  if (!r) return null;
  console.log('MBBank:', r.status, JSON.stringify(r.body).slice(0,100));
  const name = extractName(r.body);
  if (name) return { name, source: 'MBBank' };
  return null;
}

// ── API 4: TPBank ─────────────────────────────────────────────────────────
async function tryTPBank(bin, acc) {
  const r = await request(
    'ebank.tpb.vn',
    '/retail-web-internetbankingms/v1.0/transfer/inquiryAccountName',
    'POST', { creditAccount: acc, creditBankId: bin },
    { Referer: 'https://ebank.tpb.vn/', Origin: 'https://ebank.tpb.vn' }
  );
  if (!r) return null;
  console.log('TPBank:', r.status, JSON.stringify(r.body).slice(0,100));
  const name = extractName(r.body);
  if (name) return { name, source: 'TPBank' };
  return null;
}

// ── API 5: Vietcombank ────────────────────────────────────────────────────
async function tryVCB(bin, acc) {
  const r = await request(
    'www.vietcombank.com.vn', '/api/bank/getAccountName',
    'POST', { accountNumber: acc, bankBin: bin },
    { Referer: 'https://www.vietcombank.com.vn/', Origin: 'https://www.vietcombank.com.vn' }
  );
  if (!r) return null;
  console.log('VCB:', r.status, JSON.stringify(r.body).slice(0,100));
  const name = extractName(r.body);
  if (name) return { name, source: 'Vietcombank' };
  return null;
}

// ── Lookup: tất cả song song ──────────────────────────────────────────────
async function lookup(bins, acc) {
  const fns = [tryCasso, tryVietQR, tryMBBank, tryTPBank, tryVCB];
  return new Promise(resolve => {
    let done = false;
    let rem = bins.length * fns.length;
    if (!rem) return resolve(null);
    for (const bin of bins) {
      for (const fn of fns) {
        fn(bin, acc).then(r => {
          rem--;
          if (!done && r) { done = true; resolve(r); }
          else if (!rem && !done) resolve(null);
        }).catch(() => { rem--; if (!rem && !done) resolve(null); });
      }
    }
  });
}

// ── HTTP Server ───────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'NAPAS Proxy v2.0' }));
    return;
  }

  if (req.url === '/lookup' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { bins, accountNumber } = JSON.parse(body);
        if (!Array.isArray(bins) || !bins.length || !accountNumber) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Thiếu bins hoặc accountNumber' })); return;
        }
        console.log(`[${new Date().toISOString()}] acc=${accountNumber} bins=${bins.join(',')}`);
        const result = await lookup(bins, accountNumber);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (result) {
          console.log(`  ✓ ${result.name} (${result.source})`);
          res.end(JSON.stringify({ found: true, accountName: result.name, source: result.source }));
        } else {
          console.log('  ✗ Not found');
          res.end(JSON.stringify({ found: false }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));

}).listen(PORT, () => console.log(`✅ NAPAS Proxy v2.0 :${PORT}`));
