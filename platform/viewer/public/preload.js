const fs = require('fs');
const mimetypes = require('mime-types');
const path = require('path');

const { contextBridge } = require('electron');

function LocalFileData(pathReceived) {
  this.arrayBuffer = (() => {
    var buffer = fs.readFileSync(pathReceived);
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

function DICOMToFileObject(dir_path) {
  let DICOMFileObjectArray = [];

  fs.readdirSync(dir_path).forEach(file => {
    const newLocalFileData = new LocalFileData(dir_path + '/' + file);
    const newFileObject = constructFileFromLocalFileData(newLocalFileData);

    DICOMFileObjectArray.push(newFileObject);
  });

  return DICOMFileObjectArray;
}

function openDirectoriesToFindDICOMFiles(dir_path) {
  let currentDirPath = dir_path;

  let keepSearching = true;
  while (keepSearching) {
    fs.readdirSync(currentDirPath, { withFileTypes: true }).forEach(file => {
      if (file.isDirectory()) {
        currentDirPath += '/' + file.name;
      }

      if (path.extname(file.name) == '.dcm' || path.extname(file.name) == '.dicom') {
        keepSearching = false;
      }
    });
  }

  return currentDirPath;
}

const foundPath = openDirectoriesToFindDICOMFiles('./resources');
const files = DICOMToFileObject(foundPath);

contextBridge.exposeInMainWorld('files', [...files]);
