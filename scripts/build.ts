import fse from 'fs-extra';
import execa from 'execa';

execa.commandSync('tsc');

fse.copySync('./src/config.json', './dist/config.json');
