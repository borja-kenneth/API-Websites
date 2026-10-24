const nodemailer = require('nodemailer');
const { verificationEmail } = require('./emails/verification.cjs');
const {recoveryEmail}=require('./emails/recovery.cjs');
const {orderEmail}=require('./emails/order.cjs');
const {digest}=require('./security.cjs');
function createMailer(env, makeTransport = nodemailer.createTransport) {
  const user = String(env.GMAIL_USER || '').trim().toLowerCase();
  // Google displays app passwords in groups; whitespace is not part of the credential.
  const appPassword = String(env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const oauth = env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN;
  // A Google Workspace mailbox can use a custom domain. SMTP authentication
  // determines whether Google hosts and authorizes the configured sender.
  const validSender = user.length <= 254 && /^[a-z0-9._%+-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(user);
  const configured = env.MAIL_MODE !== 'disabled' && validSender && !!(oauth || appPassword);
  const transport = configured ? makeTransport({
    service: 'gmail', logger: false, debug: false, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    auth: oauth ? { type: 'OAuth2', user, clientId: env.GMAIL_CLIENT_ID, clientSecret: env.GMAIL_CLIENT_SECRET, refreshToken: env.GMAIL_REFRESH_TOKEN } : { user, pass: appPassword }
  }) : null;
  let lastDelivery = { status: 'not-attempted', category: null, at: null };
  async function dispatch(message) {
    try {
      if (!transport) throw Object.assign(Error('MAIL_NOT_CONFIGURED'), { code: 'MAIL_NOT_CONFIGURED' });
      await transport.sendMail(message);
      // SMTP acceptance does not prove inbox placement or mailbox receipt.
      lastDelivery = { status: 'provider-accepted', category: null, at: Date.now() };
    } catch (error) {
      const category = error.code === 'EAUTH' ? 'AUTHENTICATION_FAILED' : error.code === 'MAIL_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : ['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'ESOCKET', 'EDNS'].includes(error.code) ? 'CONNECTION_FAILED' : 'DELIVERY_FAILED';
      lastDelivery = { status: 'failed', category, at: Date.now() };
      throw error;
    }
  }
  return {
    configured,
    deliveryStatus: () => ({ ...lastDelivery }),
    async sendOrder(to,data,eventKey){
      await dispatch({...orderEmail(data),from:{name:'SaleSync Online',address:user},replyTo:{name:'SaleSync Online',address:user},envelope:{from:user,to:[to]},to,messageId:'<'+digest(eventKey)+'@'+user.split('@')[1]+'>',headers:{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'}});
    },
    async sendPasswordReset(to,url){
      await dispatch({...recoveryEmail(url),from:{name:'SaleSync Online',address:user},replyTo:{name:'SaleSync Online',address:user},envelope:{from:user,to:[to]},to,headers:{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'}});
    },
    async sendVerification(to, code, ttlSeconds) {
      await dispatch({ ...verificationEmail({ code, ttlSeconds }),
        from: { name: 'SaleSync Online', address: user },
        replyTo: { name: 'SaleSync Online', address: user },
        envelope: { from: user, to: [to] }, to,
        // Declare automatic transactional mail without spoofing authentication results
        // or setting priority headers that cannot control inbox placement.
        headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' } });
    },
    async sandboxEmail() {
      // This transport only generates a message in memory. It never connects to SMTP.
      const capture = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
      await capture.sendMail({ ...verificationEmail({ code: '4821', ttlSeconds: 300, sandbox: true }), from: 'sandbox@example.test', to: 'recipient@example.test' });
      return { recipient: 'recipient@example.test', status: 'captured', realEmailSent: false };
    }
  };
}
module.exports = { createMailer };
