const fs = require('node:fs');
const path = require('node:path');
const LOGO_CID = 'salesync-logo@verification.salesync';
const LOGO_FILE = path.resolve(__dirname, '../../SaleSync_Online_Alive_v5/assets/logo-email.png');
function lifetime(seconds) {
  const minutes = Math.floor(seconds / 60), remainder = seconds % 60;
  return [minutes ? `${minutes} minute${minutes === 1 ? '' : 's'}` : '', remainder ? `${remainder} second${remainder === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ');
}
function verificationEmail({ code, ttlSeconds, sandbox = false }) {
  if (typeof code !== 'string' || !/^\d{4}$/.test(code)) throw Error('INVALID_VERIFICATION_CODE');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 900) throw Error('INVALID_CODE_LIFETIME');
  const expires = lifetime(ttlSeconds);
  const text = `${sandbox ? 'SANDBOX PREVIEW — this is not a usable account code.\n\n' : ''}SaleSync Online\n\nVerify your email\n\nWe received a request to create a SaleSync Online account with this email address.\n\nYour verification code: ${code}\n\nThis code expires in ${expires} and can be used once. Return to the SaleSync tab where you registered to enter it.\n\nKeep this code private. SaleSync will never ask you to share it.\n\nIf you did not create a SaleSync account, you can safely ignore this email.\n\nSaleSync Online — Account verification.`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Verify your SaleSync email</title>
<style>@media only screen and (max-width:480px){.email-outer{padding:20px 12px!important}.email-header{padding:22px!important}.email-body{padding:28px 22px!important}.email-heading{font-size:27px!important}.email-code{font-size:40px!important;letter-spacing:10px!important;padding-left:10px!important}.email-footer{padding:20px 22px!important}}</style></head>
<body style="margin:0;padding:0;width:100%;background-color:#f3f6fb;color:#172941;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;color:#f3f6fb;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Use your verification code to finish creating your SaleSync account.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f3f6fb;"><tr><td class="email-outer" align="center" style="padding:40px 16px;">
<!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #dfe7f1;border-radius:18px;overflow:hidden;">
<tr><td class="email-header" bgcolor="#142d4e" style="padding:25px 32px;background-color:#142d4e;border-radius:17px 17px 0 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="64" valign="middle" style="width:64px;"><img src="cid:${LOGO_CID}" alt="SaleSync logo" width="64" height="64" style="display:block;width:64px;height:64px;border:0;border-radius:14px;"></td><td valign="middle" style="padding-left:15px;"><p style="margin:0;color:#ffffff;font-size:24px;font-weight:700;line-height:30px;letter-spacing:-0.6px;">SaleSync</p><p style="margin:2px 0 0;color:#9bd8ea;font-size:10px;font-weight:700;line-height:16px;letter-spacing:2.8px;">ONLINE</p></td></tr></table>
</td></tr><tr><td height="4" bgcolor="#68b8cc" style="height:4px;background-color:#68b8cc;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td class="email-body" style="padding:32px;">
${sandbox ? '<p style="margin:0 0 20px;padding:10px 12px;border:1px solid #e4ce90;border-radius:8px;background-color:#fff6dc;color:#75551b;font-size:12px;line-height:18px;font-weight:700;">SANDBOX PREVIEW &middot; No message was sent</p>' : ''}
<p style="margin:0 0 10px;color:#2864cf;font-size:10px;font-weight:700;line-height:16px;letter-spacing:1.8px;">ACCOUNT VERIFICATION</p>
<h1 class="email-heading" style="margin:0 0 14px;color:#142d4e;font-size:30px;font-weight:700;line-height:38px;letter-spacing:-0.8px;">Verify your email.</h1>
<p style="margin:0 0 25px;color:#5c6d83;font-size:15px;line-height:24px;">We received a request to create a SaleSync Online account with this email address. Enter the code below to verify it.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #d7e5fb;border-radius:12px;background-color:#eff5ff;"><tr><td align="center" style="padding:20px 12px 21px;">
<p style="margin:0 0 9px;color:#536b8a;font-size:10px;font-weight:700;line-height:16px;letter-spacing:1.6px;">YOUR VERIFICATION CODE</p>
<p class="email-code" style="margin:0;padding-left:12px;color:#245dba;font-family:Consolas,'Courier New',monospace;font-size:46px;font-weight:700;line-height:58px;letter-spacing:12px;">${code}</p>
<p style="margin:10px 0 0;color:#536b8a;font-size:12px;line-height:20px;">Valid for <strong style="color:#19395f;">${expires}</strong> &nbsp;&middot;&nbsp; One-time use</p>
</td></tr></table>
<p style="margin:22px 0 0;color:#5c6d83;font-size:13px;line-height:21px;">Return to the SaleSync tab where you registered to enter this code.</p>
<p style="margin:15px 0 0;padding-left:12px;border-left:3px solid #68b8cc;color:#536b8a;font-size:12px;line-height:20px;"><strong style="color:#19395f;">Keep this code private.</strong><br>SaleSync will never ask you to share it.</p>
</td></tr><tr><td class="email-footer" bgcolor="#f8fafc" style="padding:20px 32px;border-top:1px solid #e4ebf3;background-color:#f8fafc;border-radius:0 0 17px 17px;"><p style="margin:0;color:#697b90;font-size:12px;line-height:20px;">Didn&rsquo;t request an account? You can safely ignore this email.</p></td></tr>
</table>
<p style="margin:20px 0 0;color:#7a8ba0;font-size:11px;line-height:18px;text-align:center;">SaleSync Online<br>Account verification</p>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { subject: `${sandbox ? '[Sandbox] ' : ''}Verify your SaleSync email`, text, html,
    attachments: [{ filename: 'salesync-logo.png', content: fs.readFileSync(LOGO_FILE), contentType: 'image/png', contentDisposition: 'inline', cid: LOGO_CID }],
    disableFileAccess: true, disableUrlAccess: true };
}
module.exports = { verificationEmail, LOGO_CID, LOGO_FILE };
