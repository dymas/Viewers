const fs = require('fs');
const mimetypes = require('mime-types');
const path = require('path');

const { contextBridge } = require('electron');

function LocalFileData(pathReceived) {
  this.arrayBuffer = (() => {
    var buffer = fs.readFileSync('./resources' + pathReceived);
    var arrayBuffer = buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    return [arrayBuffer];
  })();

  this.name = path.basename(pathReceived);

  this.type = mimetypes.lookup(path.extname(pathReceived)) || undefined;
}

let files = [];

fs.readdirSync('./resources').forEach(file => {
  console.log(file);
  console.log(path.extname(file));
  if (path.extname(file) === '.dcm') {
    const newfile = new LocalFileData(file);
    files.push(newfile);
  }
});

contextBridge.exposeInMainWorld('files', { ...files });
