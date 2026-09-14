const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { BrowserPreview } = require('../extensions/file-actions/browser-preview');
const request = (url, options = {}) => new Promise((resolve, reject) => {
  const req = http.request(url, options, response => {
    let body='';response.setEncoding('utf8');response.on('data',v=>body+=v);
    response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body}));
  });req.on('error',reject);req.end();
});
test('browser preview serves relative pages/assets but blocks traversal, symlinks, hidden files and other origins',async()=>{
  const temp=process.env.VSCODE_TEST_TMP || path.resolve(__dirname,'../_tmp');await fs.mkdir(temp,{recursive:true});
  const root=await fs.mkdtemp(path.join(temp,'html-browser-'));const server=new BrowserPreview();
  try {
    const site=path.join(root,'site');await fs.mkdir(path.join(site,'pages'),{recursive:true});
    await fs.writeFile(path.join(site,'index.html'),'<a href="pages/ornaments.html">Ornaments</a>');
    await fs.writeFile(path.join(site,'pages/ornaments.html'),'<a href="../index.html">Home</a>');
    await fs.writeFile(path.join(site,'style.css'),'body{color:red}');
    await fs.writeFile(path.join(site,'.private.json'),'private');await fs.writeFile(path.join(root,'outside.html'),'private');
    await fs.symlink(path.join(root,'outside.html'),path.join(site,'linked.html'));
    const url=await server.url(path.join(site,'index.html'),site);
    assert.match(url,/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\/index.html$/);
    assert.equal((await request(url)).status,200);
    assert.match((await request(new URL('pages/ornaments.html',url))).body,/Home/);
    assert.equal((await request(new URL('style.css',url))).headers['content-type'],'text/css');
    assert.equal((await request(url,{method:'HEAD'})).body,'');
    assert.equal((await request(url,{method:'POST'})).status,405);
    assert.equal((await request(url,{headers:{Origin:'https://unrelated.example'}})).status,403);
    assert.equal((await request(url,{headers:{Host:'unrelated.example'}})).status,403);
    for(const relative of ['.private.json','linked.html','../outside.html','%2e%2e%2foutside.html','%5c..%5coutside.html','missing.html']) {
      assert.equal((await request(new URL(relative,url))).status,404,relative);
    }
    assert.equal((await request(new URL('/index.html',url))).status,404);
    assert.equal(await server.url(path.join(site,'index.html'),site),url);
    await assert.rejects(server.url(path.join(root,'outside.html'),site),/outside/);
  } finally {server.dispose();await fs.rm(root,{recursive:true,force:true});}
});
