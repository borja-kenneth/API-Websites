const {hasPermission}=require('./permissions.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomInt } = require('node:crypto');
const { openDatabase } = require('./database.cjs');
const { createMailer } = require('./mailer.cjs');
const { hashPassword, verifyPassword, safeEqual, token, digest, keyed, gmailAddress, passwordValid, publicUser } = require('./security.cjs');
const { PERMISSIONS, filterSettings, validateSettings, diffSettings, settingsService } = require('./settings.cjs');
const {commerceService}=require('./commerce.cjs');
const {commerceRoutes}=require('./commerce-routes.cjs');
const {customerFeatures}=require('./customer-features.cjs');
const {courierService}=require('./courier.cjs');
const {orderMailService}=require('./order-mail.cjs');
const {featureRoutes}=require('./feature-routes.cjs');
const localFixtures = require('./local-fixtures.cjs');

class ApiError extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, { status, code, extra }); }
}
const fail = (status, code, message, extra) => { throw new ApiError(status, code, message, extra); };
async function createApp(config, options = {}) {
  const fixtureMode = options.localFixtures === true && localFixtures.validateFixtureMode(config);
  if (fixtureMode && options.mailer?.localCapture !== true) throw Error('Local fixtures require the private captured-mail inbox, never SMTP.');
  const db = options.db || openDatabase(config), now = options.now || Date.now;
  if (!fixtureMode && db.prepare('SELECT 1 FROM audit WHERE action=? LIMIT 1').get(localFixtures.ACTION)) {
    if (!options.db) db.close();
    throw Error('This database contains local fixture identities. Use the dedicated loopback-only catalog server.');
  }
  const fixtureUser = id => !!db.prepare('SELECT 1 FROM audit WHERE actor_id=? AND action=?').get(id, localFixtures.ACTION);
  const mailer = options.mailer || createMailer(config.env);
  const inflight = new Set();
  const jobState={reservations:{scheduled:true,intervalSeconds:60,running:false,lastStartedAt:null,lastCompletedAt:null,status:'waiting'},background:{scheduled:false,intervalSeconds:15,running:false,lastStartedAt:null,lastCompletedAt:null,status:'stopped'}};
  const dummyHash = await hashPassword(token());
  const audit = (user, action, details = {}) => db.prepare('INSERT INTO audit (actor_id,actor_role,action,details,created_at) VALUES (?,?,?,?,?)').run(user?.id || null,user?.role || 'anonymous',action,JSON.stringify(details),now());
  const settings = settingsService(db, now, audit, fail);
  const commerce=commerceService({db,config,settings,now,audit,fail});
  const posCommerce=require('./pos-connector.cjs').posConnector({s:commerce,db,config,fail,fetchImpl:options.posCommerceFetch});commerce.setPosConnector(posCommerce);
  const features=customerFeatures({s:commerce,db,config,now,audit,fail});
  const orderMail=orderMailService({s:commerce,db,config,now,audit,mailer});commerce.setFeatures({...features,enqueueEmail:orderMail.enqueueEmail});
  const paymongo=require('./paymongo.cjs').paymongoService({s:commerce,db,config,now,audit,fail,fetchImpl:options.paymongoFetch});
  const courier=courierService({s:commerce,db,config,now,audit,fail,fetchImpl:options.courierFetch});
  const featureRouter=featureRoutes({s:commerce,f:features,courier,mail:mailer,db,config,settings,now,audit,fail});
  const pos=require('./pos-inventory.cjs').posInventory({s:commerce,db,config,now,audit,fail,fetchImpl:options.posFetch});
  const technical=require('./maintenance.cjs').maintenanceOperations({db,config,mailer,settings,now,audit,fail,jobs:()=>structuredClone(jobState),pos});
  const commerceRouter=commerceRoutes({service:commerce,db,config,settings,now,audit,fail,mailer,productPage:features.productPage,pos:posCommerce});
  const cookie = (res, name, value, seconds) => {
    const values = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...values, `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.secureCookie ? '; Secure' : ''}`]);
  };
  function rate(key, limit, seconds) {
    const k = keyed(config.secret, key), timestamp=now();
    const row=db.prepare(`INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN resets_at<=? THEN 1 ELSE count+1 END,
      resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING count,resets_at`).get(k,timestamp+seconds*1000,timestamp,timestamp);
    if(row.count>limit)fail(429,'RATE_LIMITED','Too many requests. Please try again later.',{retryAfter:Math.ceil((row.resets_at-timestamp)/1000)});
  }
  function getSession(req) {
    const match = (req.headers.cookie || '').match(/(?:^|;\s*)ss_session=([A-Za-z0-9_-]+)/);
    if (!match) return null;
    const row = db.prepare('SELECT u.*,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(digest(match[1]));
    return row && (!localFixtures.fixtureAddress(row.email) || fixtureMode && fixtureUser(row.id)) && row.expires_at > now() && row.status === 'active' && row.verified_at ? { user: row, raw: match[1], csrf: keyed(config.secret,'csrf:'+match[1]) } : null;
  }
  function requireUser(session, permission) {
    if (!session) fail(401,'UNAUTHENTICATED','Please sign in.');
    if (permission && !hasPermission(session.user.role,permission)) fail(403,'FORBIDDEN','Your account does not have permission for this action.');
    return session.user;
  }
  function pending(req) {
    const raw = (req.headers.cookie || '').match(/(?:^|;\s*)ss_pending=([A-Za-z0-9_-]+)/)?.[1];
    const row = raw && db.prepare('SELECT u.*,c.pending_hash,c.pending_expires_at,c.nonce,c.code_hash,c.expires_at,c.attempts,c.last_sent_at,c.state FROM challenges c JOIN users u ON u.id=c.user_id WHERE c.pending_hash=?').get(digest(raw));
    if (!row || row.status !== 'pending' || row.pending_expires_at <= now()) fail(401,'NO_PENDING_REGISTRATION','Sign in with your registration email and password to continue verification.');
    return row;
  }
  function pendingState(u) {
    const email = settings.current().data.email;
    return { name: u.name, email: u.email, state: u.state, expiresAt: u.expires_at, resendAt: u.last_sent_at + email.resendSeconds*1000, attemptsRemaining: Math.max(0,email.maxAttempts-u.attempts) };
  }
  function attachPending(res,u) {
    const raw = token();
    db.prepare('INSERT INTO challenges (user_id,pending_hash,pending_expires_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET pending_hash=excluded.pending_hash,pending_expires_at=excluded.pending_expires_at').run(u.id,digest(raw),now()+7*86400000);
    cookie(res,'ss_pending',raw,7*86400);
  }
  async function issueCode(u) {
    if (inflight.has(u.id)) fail(409,'DELIVERY_IN_PROGRESS','A code delivery is already in progress.');
    const cfg = settings.current().data.email;
    const challenge = db.prepare('SELECT * FROM challenges WHERE user_id=?').get(u.id);
    const wait = Math.ceil((challenge.last_sent_at+cfg.resendSeconds*1000-now())/1000);
    if (challenge.last_sent_at && wait > 0) fail(429,'RESEND_COOLDOWN','Please wait before requesting another code.',{ retryAfter: wait });
    rate('send:'+u.id,cfg.maxSendsPerHour,3600);
    inflight.add(u.id);
    const nonce = token();
    let code,fingerprint;
    do { code=String(randomInt(0,10000)).padStart(4,'0');fingerprint=keyed(config.secret,`${u.id}:last-code:${code}`); } while (fingerprint===challenge.last_code_fingerprint);
    const issued=db.prepare("UPDATE challenges SET nonce=?,code_hash=NULL,state='sending',attempts=0,expires_at=NULL,last_sent_at=?,last_code_fingerprint=? WHERE user_id=? AND nonce IS ? AND last_sent_at=?").run(nonce,now(),fingerprint,u.id,challenge.nonce,challenge.last_sent_at);
    if(!issued.changes){inflight.delete(u.id);fail(409,'DELIVERY_IN_PROGRESS','Another code request changed this registration. Please retry after the cooldown.');}
    try {
      await mailer.sendVerification(u.email,code,cfg.ttlSeconds);
      db.prepare("UPDATE challenges SET code_hash=?,expires_at=?,state='sent' WHERE user_id=? AND nonce=?").run(keyed(config.secret,`${u.id}:${nonce}:${code}`),now()+cfg.ttlSeconds*1000,u.id,nonce);
      audit(null,'VERIFICATION_DELIVERED',{ accountId: u.id });
      return { message: 'A verification code was accepted by the email provider. Check your inbox and spam folder.', delivery: 'sent', ...pendingState({ ...u,...db.prepare('SELECT * FROM challenges WHERE user_id=?').get(u.id) }) };
    } catch {
      db.prepare("UPDATE challenges SET code_hash=NULL,state='delivery_failed' WHERE user_id=? AND nonce=?").run(u.id,nonce);
      audit(null,'VERIFICATION_DELIVERY_FAILED',{ accountId: u.id });
      fail(503,mailer.configured ? 'DELIVERY_FAILED' : 'MAIL_NOT_CONFIGURED',mailer.configured ? 'Email delivery failed. Your details are saved; try resending after the cooldown.' : 'Email delivery is not configured yet. Your registration details are saved; contact the store or try again later.',{ retryAfter: cfg.resendSeconds, pending: true });
    } finally { inflight.delete(u.id); }
  }
  function newSession(res,u) {
    const raw = token();
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(raw),u.id,now()+config.sessionSeconds*1000);
    cookie(res,'ss_session',raw,config.sessionSeconds);
    return { user: publicUser(u), csrfToken: keyed(config.secret,'csrf:'+raw), permissions: PERMISSIONS[u.role] };
  }
  async function body(req,maxLength=65536) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415,'JSON_REQUIRED','Send an application/json request.');
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > maxLength) fail(413,'BODY_TOO_LARGE','Request is too large.'); chunks.push(chunk); }
    try { const result = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(); return result; } catch { fail(400,'INVALID_JSON','Send a JSON object.'); }
  }
  const allowedOrigins = new Set([config.origin,...String(config.env.API_ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean)]);
  const server = http.createServer(async(req,res) => {
    const requestId = randomUUID();
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','same-origin'); res.setHeader('X-Frame-Options','DENY');
    res.setHeader('X-Request-Id',requestId);
    // The retained prototype uses inline scripts and inline image fallbacks.
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://images.unsplash.com ${posCommerce.imageOrigin||''}; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    const json = (status,data) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data)); };
    try {
      if (fixtureMode && !localFixtures.localRequest(req, config)) fail(403,'LOCAL_ONLY','This demonstration accepts direct loopback requests only; proxies and tunnels are prohibited.');
      const url = new URL(req.url,config.origin), p = url.pathname.replace(/^\/api\/v1(?=\/|$)/,'/api');
      if(p==='/api/webhooks/paymongo'&&req.method==='POST'){rate('paymongo-webhook:'+req.socket.remoteAddress,120,60);try{return json(200,await paymongo.webhook(req));}catch(error){db.prepare('INSERT INTO system_events(reference,category,created_at) VALUES (?,?,?)').run(requestId,'PAYMONGO_WEBHOOK_REJECTED',now());throw error;}}
      if(p==='/api/webhooks/aftership'&&req.method==='POST'){rate('courier-webhook:'+req.socket.remoteAddress,120,60);return json(200,await courier.webhook(req));}
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) fail(403,'ORIGIN_DENIED','This origin is not allowed.');
      if (origin && allowedOrigins.has(origin)) { res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin'); }
      if (req.method === 'OPTIONS') { res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-CSRF-Token,Idempotency-Key','Access-Control-Max-Age':'600'});res.end();return; }
      if (p.startsWith('/api/')) {
        const session = getSession(req), mutation = !['GET','HEAD'].includes(req.method);
        if (mutation && (!origin || req.headers['sec-fetch-site'] === 'cross-site')) fail(403,'ORIGIN_REQUIRED','Use an approved same-site origin for changes.');
        if (mutation && session && !p.startsWith('/api/auth/') && !safeEqual(req.headers['x-csrf-token'] || '',session.csrf)) fail(403,'CSRF_INVALID','Refresh your session before making changes.');
        const ip = req.socket.remoteAddress || 'unknown';
        rate('api:'+ip,600,60);
        commerce.expire();
        if(await paymongo.handle({p,req,session,body,json,rate,requireUser}))return;
        if(await pos.handle({p,req,session,body,json,rate,requireUser}))return;
        if(await technical.handle({p,req,session,body,json,rate,requireUser}))return;
        if(await featureRouter.handle({p,req,res,session,body,json,rate,cookie,requireUser}))return;
        if(await commerceRouter.handle({p,req,res,session,body,json,rate,ip,cookie,requireUser}))return;
        if (req.method === 'GET' && p === '/api/health') return json(200,{ status:'ok',apiVersion:'1' });
        if (req.method === 'GET' && p === '/api/openapi.json') return json(200,JSON.parse(fs.readFileSync(path.join(config.root,'docs/openapi.json'),'utf8')));
        if (req.method === 'GET' && p === '/api/auth/session') return json(200,session ? { user:publicUser(session.user),csrfToken:session.csrf,permissions:PERMISSIONS[session.user.role] } : { user:null,csrfToken:null,permissions:[] });
        if (req.method === 'GET' && p === '/api/auth/pending') return json(200,pendingState(pending(req)));
        if (req.method === 'POST' && p === '/api/auth/register') {
          rate('register:'+ip,10,3600);
          const input = await body(req), email = gmailAddress(input.email);
          if (!email || typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.length > 80 || !passwordValid(input.password)) fail(422,'INVALID_REGISTRATION','Enter a name, a valid Gmail address, and a password of 12–128 bytes.');
          if (Object.keys(input).some(k=>!['name','email','password'].includes(k))) fail(422,'UNKNOWN_FIELD','Registration accepts name, email, and password only.');
          let user = db.prepare('SELECT * FROM users WHERE email_key=?').get(email.key);
          if (user) {
            if (user.status !== 'pending' || !await verifyPassword(input.password,user.password_hash)) fail(409,'ACCOUNT_EXISTS','This Gmail account is already registered. Sign in to continue.');
          } else {
            const hash = await hashPassword(input.password);
            user = { id:randomUUID(),name:input.name.trim(),email:email.email,email_key:email.key,password_hash:hash,role:'customer',status:'pending',verified_at:null,created_at:now() };
            try { db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run(...Object.values(user)); } catch(e) { if(String(e.message).includes('UNIQUE')) fail(409,'ACCOUNT_EXISTS','This Gmail account is already registered.'); throw e; }
          }
          attachPending(res,user);
          let result;
          try { result = await issueCode(user); }
          catch (error) { if (error instanceof ApiError) error.extra.pending = true; throw error; }
          return json(201,result);
        }
        if (req.method === 'POST' && p === '/api/auth/resend') {
          await body(req); rate('resend:'+ip,15,3600);
          return json(200,await issueCode(pending(req)));
        }
        if (req.method === 'POST' && p === '/api/auth/verify') {
          rate('verify-ip:'+ip,60,3600);
          const input = await body(req), u = pending(req), cfg = settings.current().data.email;
          rate('verify-user:'+u.id,20,3600);
          if (u.attempts >= cfg.maxAttempts || u.state === 'locked') fail(429,'TOO_MANY_ATTEMPTS','Too many incorrect attempts. Request a new code after the cooldown.');
          if (u.state !== 'sent' || !u.code_hash) fail(422,'NO_ACTIVE_CODE','Request a new verification code.');
          if (u.expires_at <= now()) fail(410,'CODE_EXPIRED','This code expired. Request a new one.');
          const matches = typeof input.code === 'string' && /^\d{4}$/.test(input.code) && safeEqual(keyed(config.secret,`${u.id}:${u.nonce}:${input.code}`),u.code_hash);
          if (!matches) {
            const result=db.prepare("UPDATE challenges SET attempts=attempts+1,state=CASE WHEN attempts+1>=? THEN 'locked' ELSE 'sent' END,code_hash=CASE WHEN attempts+1>=? THEN NULL ELSE code_hash END WHERE user_id=? AND nonce=? AND state='sent' RETURNING attempts").get(cfg.maxAttempts,cfg.maxAttempts,u.id,u.nonce);
            if(!result)fail(409,'CODE_CHANGED','The code changed. Use the latest code or request a new one.');
            const attempts=result.attempts, locked=attempts>=cfg.maxAttempts;
            fail(locked?429:422,locked?'TOO_MANY_ATTEMPTS':'CODE_INCORRECT',locked?'Too many incorrect attempts. Request a new code after the cooldown.':'The verification code is incorrect.',{ attemptsRemaining:Math.max(0,cfg.maxAttempts-attempts) });
          }
          db.exec('BEGIN IMMEDIATE');
          try {
            const consumed=db.prepare("DELETE FROM challenges WHERE user_id=? AND nonce=? AND code_hash=? AND state='sent' AND attempts<? AND expires_at>?").run(u.id,u.nonce,u.code_hash,cfg.maxAttempts,now());
            if(!consumed.changes)fail(409,'CODE_CHANGED','This code has already been consumed or replaced.');
            db.prepare("UPDATE users SET status='active',verified_at=? WHERE id=? AND status='pending'").run(now(),u.id);
            audit(u,'CUSTOMER_VERIFIED'); db.exec('COMMIT');
          } catch(e) { db.exec('ROLLBACK');throw e; }
          cookie(res,'ss_pending','',0);
          return json(200,{ message:'Email verified. Your account is active.',...newSession(res,{...u,status:'active',verified_at:now()}) });
        }
        if (req.method === 'POST' && p === '/api/auth/login') {
          rate('login-ip:'+ip,30,900);
          const input = await body(req), email = gmailAddress(input.email) || (fixtureMode && localFixtures.fixtureAddress(input.email));
          rate('login-email:'+(email?.key || 'invalid'),8,900);
          const u = email && db.prepare('SELECT * FROM users WHERE email_key=?').get(email.key);
          const valid = await verifyPassword(typeof input.password === 'string' && Buffer.byteLength(input.password)<=128 ? input.password : '',u?.password_hash || dummyHash);
          if (!u || !valid || u.status === 'suspended' || localFixtures.fixtureAddress(u.email) && (!fixtureMode || !fixtureUser(u.id))) fail(401,'LOGIN_FAILED','Email or password is incorrect, or the account is unavailable.');
          if (u.status === 'pending') { attachPending(res,u);fail(403,'EMAIL_UNVERIFIED','Verify your email to activate your account.',{ pending:true }); }
          if (session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(session.raw));
          audit(u,'SIGNED_IN');
          return json(200,newSession(res,u));
        }
        if (req.method === 'POST' && p === '/api/auth/logout') {
          await body(req);
          if (session && !safeEqual(req.headers['x-csrf-token'] || '',session.csrf)) fail(403,'CSRF_INVALID','Refresh your session.');
          if (session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(session.raw));
          cookie(res,'ss_session','',0);cookie(res,'ss_pending','',0);return json(200,{ message:'Signed out.' });
        }
        if (p.startsWith('/api/admin/')) {
          const u = requireUser(session);
          if (!['management','maintenance'].includes(u.role)) fail(403,'FORBIDDEN','Administrator access required.');
          if (req.method === 'GET' && p === '/api/admin/settings') {
            const cfg = settings.current();return json(200,{ version:cfg.version,data:filterSettings(cfg.data,u.role),draft:settings.view(settings.draft(u),u),history:settings.history(u) });
          }
          if (req.method === 'GET' && p === '/api/admin/audit') {
            const technical = u.role === 'maintenance';requireUser(session,technical?'audit:technical':'audit:business');
            const scope=technical?"a.actor_role='maintenance' OR a.action LIKE 'VERIFICATION_%' OR a.action LIKE 'RECOVERY_%' OR a.action='ADMIN_PROVISIONED' OR a.action LIKE 'PAYMONGO_%' OR a.action='POS_CONNECTION_CHECKED'":"a.actor_role IN ('management','customer') OR a.action LIKE 'TRACKING_%' OR a.action LIKE 'ORDER_EMAIL_%'";
            const rows = db.prepare('SELECT a.*,u.name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE '+scope+' ORDER BY a.id DESC LIMIT 300').all();
            return json(200,{events:rows.map(x=>{const value={...x,details:JSON.parse(x.details)};if(technical){const details={};if(/^DATABASE_(BACKUP|INTEGRITY)_/.test(x.action)){if(typeof value.details.ok==='boolean')details.ok=value.details.ok;if(/^backup-[a-f0-9-]{36}\.sqlite$/.test(value.details.backupId||''))details.backupId=value.details.backupId;}return {...value,actor_id:null,actor_name:x.actor_role==='maintenance'?x.actor_name:null,details};}return value;})});
          }
          if (p.startsWith('/api/admin/sandbox')) {
            requireUser(session,'sandbox:use');
            if (req.method === 'POST' && p === '/api/admin/sandbox/draft') { const input=await body(req);return json(200,{draft:settings.save(u,input.settings,input.revision)}); }
            if (req.method === 'DELETE' && p === '/api/admin/sandbox/draft') {
              const input=await body(req),d=settings.draft(u);
              if (d && d.revision!==input.revision) fail(409,'DRAFT_CONFLICT','The draft changed. Reload before discarding.');
              db.prepare('DELETE FROM drafts WHERE actor_id=?').run(u.id);audit(u,'SANDBOX_DRAFT_DISCARDED');return json(200,{discarded:true});
            }
            if (req.method === 'GET' && p === '/api/admin/sandbox/preview') {
              const draft=settings.draft(u), live=settings.current();
              return json(200,{sandbox:true,data:filterSettings(draft?.data || live.data,u.role),baseVersion:draft?.baseVersion || live.version,changes:diffSettings(live.data,draft?.data || live.data).filter(c=>Object.hasOwn(filterSettings(live.data,u.role),c.section)),records:db.prepare('SELECT id,kind,data,created_at FROM sandbox_records WHERE actor_id=? ORDER BY created_at DESC LIMIT 30').all(u.id).map(r=>({...r,data:JSON.parse(r.data)}))});
            }
            if (req.method === 'POST' && p === '/api/admin/sandbox/validate') { await body(req);const d=settings.draft(u);return json(200,{valid:!!d && !validateSettings(d.data).length,errors:d?validateSettings(d.data):['Save a draft first.'],stale:!!d && d.baseVersion!==settings.current().version}); }
            if (req.method === 'POST' && p === '/api/admin/sandbox/test') {
              const input=await body(req);rate('sandbox:'+u.id,30,60);
              let result;
              if (input.kind==='email' && u.role==='maintenance') result=await mailer.sandboxEmail();
              else if (input.kind==='checkout' && u.role==='management') {
                const first=commerce.products().find(p=>p.primary>0);if(!first)fail(409,'INVALID_STOCK','Add an available product before testing checkout.');
                const draft=settings.draft(u),priced=commerce.quote(input.items||[{id:first.id,qty:1}],input.delivery||{name:'Test Buyer',phone:'09123456789',address:'123 Test Street',barangay:'Test Barangay',city:'Pasig',province:'Metro Manila',postal:'1609'},draft?.data||settings.current().data);
                result={status:'quote_validated',recipient:'buyer@example.test',paymentMode:'test-only',total:priced.totalCents/100,shipping:priced.shipping,lines:priced.lines,charged:false,inventoryChanged:false,productionOrderCreated:false};
              }
              else fail(403,'FORBIDDEN','This sandbox test is not available for your role.');
              db.prepare('INSERT INTO sandbox_records VALUES (?,?,?,?,?)').run(randomUUID(),u.id,input.kind,JSON.stringify(result),now());audit(u,'SANDBOX_TEST',{kind:input.kind});return json(200,{sandbox:true,result});
            }
            if (req.method === 'POST' && p === '/api/admin/sandbox/apply') return json(200,settings.apply(u,await body(req)));
          }
          if (req.method === 'POST' && /^\/api\/admin\/settings\/history\/[^/]+\/rollback$/.test(p)) return json(200,settings.rollback(u,p.split('/').at(-2),await body(req)));
          // No endpoint can create administrators or assign roles.
          fail(404,'NOT_FOUND','Endpoint not found.');
        }
        fail(404,'NOT_FOUND','Endpoint not found.');
      }
      if (!['GET','HEAD'].includes(req.method)) fail(405,'METHOD_NOT_ALLOWED','Method not allowed.');
      const relative = decodeURIComponent(url.pathname==='/'?'/SaleSync_Online_Alive.html':url.pathname);
      if (!(relative==='/SaleSync_Online_Alive.html' || relative==='/SaleSync_Online_Offline_Alive.html' || relative.startsWith('/assets/'))) fail(404,'NOT_FOUND','Page not found.');
      const uploaded=relative.startsWith('/assets/uploads/');
      if(uploaded&&!/^\/assets\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(relative))fail(404,'NOT_FOUND','Image not found.');
      const staticRoot=uploaded?config.uploadDir:path.join(config.root,'SaleSync_Online_Alive_v5'), file=uploaded?path.resolve(staticRoot,path.basename(relative)):path.resolve(staticRoot,'.'+relative);
      if (!file.startsWith(staticRoot+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) fail(404,'NOT_FOUND','Asset not found.');
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});
      res.end(req.method==='HEAD'?undefined:fs.readFileSync(file));
    } catch(e) {
      if (!(e instanceof ApiError)) {
        // Keep request bodies, email addresses, SMTP errors, passwords and codes out of logs.
        db.prepare('INSERT INTO system_events (reference,category,created_at) VALUES (?,?,?)').run(requestId,'INTERNAL_ERROR',now());
      }
      if (e.extra?.retryAfter) res.setHeader('Retry-After',String(e.extra.retryAfter));
      json(e.status || 500,{ error:{code:e.code || 'INTERNAL_ERROR',message:e instanceof ApiError?e.message:'An unexpected error occurred.',requestId,...(e.extra || {})} });
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  const expiryTimer=setInterval(()=>{const job=jobState.reservations;job.running=true;job.lastStartedAt=now();try{commerce.expire();job.status='completed';}catch{job.status='failed';db.prepare('INSERT INTO system_events(reference,category,created_at) VALUES (?,?,?)').run(randomUUID(),'RESERVATION_CLEANUP_FAILED',now());}finally{job.running=false;job.lastCompletedAt=now();}},60000);expiryTimer.unref();
  let workerTimer=null,workerRun=null;
  function runWorkers(){if(workerRun)return workerRun;const job=jobState.background;job.running=true;job.status='running';job.lastStartedAt=now();workerRun=(async()=>{await courier.poll();await orderMail.flush();await paymongo.poll();await posCommerce.reconcileOrders();job.status='completed';})().catch(()=>{job.status='failed';db.prepare('INSERT INTO system_events(reference,category,created_at) VALUES (?,?,?)').run(randomUUID(),'BACKGROUND_JOB_FAILED',now());}).finally(()=>{job.running=false;job.lastCompletedAt=now();workerRun=null;});return workerRun;}
  function startWorkers(){if(!workerTimer){workerTimer=setInterval(runWorkers,15000);workerTimer.unref();jobState.background.scheduled=true;runWorkers();}}
  return { server,db,settings,audit,commerce,features,courier,orderMail,posCommerce,runWorkers,startWorkers,close:async()=>{clearInterval(expiryTimer);clearInterval(workerTimer);await workerRun;await orderMail.wait();await new Promise(r=>server.listening?server.close(r):r());db.close();} };
}
async function provisionAdmin(db, {name,email,password,role}, now=Date.now) {
  const normalized=gmailAddress(email);
  if (!['maintenance','management'].includes(role) || !normalized || typeof name!=='string' || name.trim().length<2 || name.length>80 || !passwordValid(password)) throw Error('Provide a name, Gmail address, password of at least 12 characters, and maintenance or management role.');
  const hash=await hashPassword(password),id=randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
  db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,'active',?,?)").run(id,name.trim(),normalized.email,normalized.key,hash,role,now(),now());
  db.prepare("INSERT INTO audit (actor_id,actor_role,action,details,created_at) VALUES (?,'system','ADMIN_PROVISIONED',?,?)").run(id,JSON.stringify({role,method:'local CLI'}),now());
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK');throw error; }
  return { id,role };
}
module.exports = { createApp,provisionAdmin };
