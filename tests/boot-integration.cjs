const http=require('node:http'),listen=http.Server.prototype.listen;
http.Server.prototype.listen=function(...args){if(args[0]===3000)args[0]=0;this.once('listening',()=>process.send?.({port:this.address().port}));return listen.apply(this,args);};
const local=require('../back/localAiSettings');
const read=local.readForServer;
local.readForServer=()=>{const value=read();return value&&process.env.TEST_MODEL_URL?{...value,provider:'compatible',baseUrl:process.env.TEST_MODEL_URL}:value;};
require('../back/server');
