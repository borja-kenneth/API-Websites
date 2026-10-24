const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const { loadConfig } = require('./config.cjs');
const { openDatabase } = require('./database.cjs');
const { provisionAdmin } = require('./app.cjs');
(async()=>{
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Use a local interactive terminal.');
  const config=loadConfig();
  console.log('Local administrator provisioning. Database: '+config.dbPath);
  console.log('For a presentation account, select an isolated database using DATABASE_PATH before running this command.');
  let muted=false;
  const output=new Writable({write(chunk,encoding,cb){if(!muted)process.stdout.write(chunk);cb();}});
  const rl=readline.createInterface({input:process.stdin,output,terminal:true});
  let db;
  try {
    const name=await rl.question('Administrator full name: ');
    const email=await rl.question('Individual Gmail address: ');
    const role=(await rl.question('Role (maintenance / management): ')).trim();
    if(!['maintenance','management'].includes(role))throw Error('Choose a supported administrator role.');
    process.stdout.write('Password (12+ characters; hidden): ');muted=true;
    const password=await rl.question('');muted=false;process.stdout.write('\n');
    process.stdout.write('Confirm password (hidden): ');muted=true;
    const confirmation=await rl.question('');muted=false;process.stdout.write('\n');
    if(password!==confirmation)throw Error('Passwords do not match.');
    if(await rl.question('Type CREATE '+role.toUpperCase()+' to confirm this database and role: ')!=='CREATE '+role.toUpperCase())throw Error('Confirmation required.');
    db=openDatabase(config);
    await provisionAdmin(db,{name,email,password,role});
    console.log('Individual administrator account created. No existing account was changed.');
  } finally {rl.close();db?.close();}
})().catch(()=>{console.error('No administrator created. Use a local interactive terminal; check matching passwords, the database/role confirmation, valid fields and unique Gmail address.');process.exitCode=1;});
