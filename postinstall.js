'use strict'

const fs = require('fs');

try{
    fs.copyFileSync("dist/appi2.js", "../../public/appi2.js");
    fs.copyFileSync("dist/appi2.wasm", "../../public/appi2.wasm");
    fs.copyFileSync("dist/appi2.worker.js", "../../public/appi2.worker.js");
    fs.copyFileSync("dist/appi2basic.js", "../../public/appi2basic.js");
    fs.copyFileSync("dist/appi2basic.wasm", "../../public/appi2basic.wasm");
}
catch(e)
{
    console.log("Failed to move files");
}
 

