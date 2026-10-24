const { loadConfig, ConfigurationError } = require('./config.cjs');
const { createApp } = require('./app.cjs');
(async()=>{
  const config=loadConfig(),app=await createApp(config);
  try {
    await new Promise((resolve,reject)=>{
      app.server.once('error',reject);
      app.server.listen(config.port,config.host,()=>{app.server.removeListener('error',reject);resolve();});
    });
  } catch(error) { await app.close();throw error; }
  app.startWorkers();
  console.log(`SaleSync: ${config.origin} | API: ${config.origin}/api/v1/health`);
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();process.exit(0);});
})().catch(error=>{console.error(error instanceof ConfigurationError ? 'SaleSync configuration: '+error.message : error.code==='EADDRINUSE' ? 'Unable to start SaleSync: configured port is already in use.' : 'Unable to start SaleSync. Check the environment settings and database path.');process.exitCode=1;});
