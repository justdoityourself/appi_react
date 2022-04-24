'use strict'

const fs = require('fs');

try{
    fs.copyFileSync("dist/appi2.js", "../../public/appi2.js");
    fs.copyFileSync("dist/appi2.wasm", "../../public/appi2.wasm");
    fs.copyFileSync("dist/appi2.worker.js", "../../public/appi2.worker.js");
}
catch(e)
{
    console.log("Failed to move files");
}
 

