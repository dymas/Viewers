const fs = require('fs');

const { contextBridge } = require('electron');

let files = [];

fs.readdirSync('../../').forEach(file => {
  files.push(file);
});

contextBridge.exposeInMainWorld('files', { ...files });
