import nconf from 'nconf';
import Stream from 'stream';
import split from 'split';
import { WriteStream } from 'tty';

export function separator() {
  console.log('');
}

export function saveConfig() {
  return new Promise((resolve, reject) => {
    nconf.save(function (err: Error) {
      if (err) {
        reject(err);
      } else {
        resolve(undefined);
      }
    });
  });
}

export function streamPrint(reader?: Stream.Readable, stream?: WriteStream) {
  if (stream) {
    reader?.pipe(split(undefined, null, { trailing: false })).pipe(stream);
  } else {
    reader?.pipe(process.stdout);
  }
}
