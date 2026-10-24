/* Read-only public DNS diagnostics. Never authenticates, sends mail, or edits DNS. */
const {Resolver}=require('node:dns').promises;
const fs=require('node:fs');
const path=require('node:path');
async function inspectSenderDns({domain,selector='google',resolveTxt}) {
  if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain||''))throw Error('Configure a valid sender domain before checking DNS.');
  if(!/^[a-z0-9_-]{1,63}$/i.test(selector))throw Error('Use a valid DKIM selector from the received message.');
  async function lookup(name,pattern){
    try{const records=(await resolveTxt(name)).map(parts=>parts.join('')).filter(value=>pattern.test(value));return {name,records,found:records.length>0};}
    catch(error){if(['ENODATA','ENOTFOUND'].includes(error.code))return {name,records:[],found:false};return {name,error:'DNS_LOOKUP_FAILED',found:null};}
  }
  const [spf,dmarc,dkim]=await Promise.all([lookup(domain,/^v=spf1(?:\s|$)/i),lookup('_dmarc.'+domain,/^v=DMARC1(?:;|\s|$)/i),lookup(selector+'._domainkey.'+domain,/(?:^|;)\s*p=/i)]);
  return {checkedAt:new Date().toISOString(),domain,selector,spf,dmarc,dkim,
    notes:['DNS records alone cannot prove a delivered message passes authentication or guarantee inbox placement.','DKIM lookup checks only the supplied selector; a different selector may be in use.','Inspect SPF, DKIM and DMARC in the received email headers for actual authentication results.']};
}
async function main(){
  const domain=String(process.env.GMAIL_USER||'').trim().toLowerCase().split('@')[1];
  const selector=process.argv.find(arg=>arg.startsWith('--selector='))?.slice(11)||'google';
  const resolver=new Resolver({timeout:4000,tries:1});
  const report=await inspectSenderDns({domain,selector,resolveTxt:name=>resolver.resolveTxt(name)});
  const out=path.resolve(__dirname,'../.preview');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'email-dns-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={inspectSenderDns};
