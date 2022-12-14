const fs = require('fs');
const mimetypes = require('mime-types');
const path = require('path');

const { contextBridge } = require('electron');

function LocalFileData(pathReceived) {
  this.arrayBuffer = (() => {
    var buffer = fs.readFileSync('./resources/' + pathReceived);
    var arrayBuffer = buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    return [arrayBuffer];
  })();

  this.name = path.basename(pathReceived);

  this.type = mimetypes.lookup(path.extname(pathReceived)) || undefined;
}

function constructFileFromLocalFileData(localFileData) {
  return new File(localFileData.arrayBuffer, localFileData.name, { type: localFileData.type });
};

let files = [];

fs.readdirSync('./resources').forEach(file => {
  console.log(file);
  console.log(path.extname(file));
  if (path.extname(file) === '.dcm') {
    const newfile = new LocalFileData(file);

    const fileobject = constructFileFromLocalFileData(newfile);

    files.push(fileobject);
  }
});

contextBridge.exposeInMainWorld('files', [...files]);
