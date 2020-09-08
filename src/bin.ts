#!/usr/bin/env node
import { program } from 'commander';
import nconf from 'nconf';
import path from 'path';
import prettier from 'prettier';
import signale from 'signale';
import fse from 'fs-extra';
import ctx from './ctx';
import './ComRunner/bin';
import './BlockRunner/bin';

program.version(require(path.join(ctx.INSTALL_PATH, './package.json')).version);
program.option('-c, --config', 'show local config').action(props => {
  if (props.config) {
    console.log('配置文件地址: ', ctx.CONFIG_PATH);
    console.log('本地block缓存位置: ', ctx.BLOCK_PATH);
    console.log('本地com缓存位置: ', ctx.COM_PATH);
    console.log(
      '本地配置: ',
      prettier.format(fse.readFileSync(ctx.CONFIG_PATH).toString('utf-8'), {
        parser: 'json',
      }),
    );
  }
});
if (!fse.existsSync(ctx.CONFIG_PATH)) {
  signale.info('初始化配置文件');
  fse.copySync(ctx.SOURCE_CONFIG, ctx.CONFIG_PATH);
}

nconf.argv().env().file({ file: ctx.CONFIG_PATH });
program.parse(process.argv);
