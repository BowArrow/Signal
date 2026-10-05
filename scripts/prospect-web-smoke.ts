import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { findBusinessPages } from '../src/core/sales/prospect-research.js';
import { initializeMarketing } from '../src/core/marketing/store.js';
const app=createApp({databaseUrl:':memory:',logger:silentLogger});
try { initializeMarketing(app); console.log(JSON.stringify(await findBusinessPages(app,'independent grant writing consultant United States contact reports',AbortSignal.timeout(30000)))); }
catch(e) { console.log(JSON.stringify({error:e instanceof Error?e.message:String(e)}));process.exitCode=1; }
finally{app.close();}
